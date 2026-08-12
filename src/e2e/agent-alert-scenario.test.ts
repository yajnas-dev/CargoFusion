import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/domain/db";
import { SESSION_COOKIE } from "@/auth/session";
import { containerManagementAgent } from "@/agent-monitor/ContainerManagementAgent";

import { POST as loginRoute } from "@/app/api/auth/login/route";
import { GET as getAlerts } from "@/app/api/agent/alerts/route";
import { POST as applyAlert } from "@/app/api/agent/alerts/[id]/apply/route";
import { GET as getTaskDetail } from "@/app/api/tasks/[id]/route";

function jsonRequest(url: string, body: unknown, cookie?: string) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function getRequest(url: string, cookie?: string) {
  return new NextRequest(url, { headers: cookie ? { Cookie: cookie } : {} });
}

function idParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function loginCookie(email: string, password: string): Promise<string> {
  const res = await loginRoute(jsonRequest("http://localhost/api/auth/login", { email, password }));
  expect(res.status).toBe(200);
  const token = res.cookies.get(SESSION_COOKIE)?.value;
  expect(token).toBeTruthy();
  return `${SESSION_COOKIE}=${token}`;
}

/**
 * Mirrors full-demo-scenario.test.ts's style (real route handlers, real
 * DB, cookie-based auth via the real login route) for the Container
 * Management Agent's own lifecycle: a real yard condition -> the agent
 * detecting and raising an alert -> a supervisor applying it through the
 * live HTTP route -> the underlying deterministic effect actually
 * happening -> a complete, correctly-attributed audit trail.
 */
describe("Agent alert scenario: blocked-lane condition -> raised -> applied -> audit trail", () => {
  const mutatedLaneIds: string[] = [];
  const createdTaskIds: string[] = [];
  const createdAlertIds: string[] = [];

  afterEach(async () => {
    if (createdAlertIds.length > 0) {
      await prisma.auditEvent.deleteMany({ where: { agentAlertId: { in: createdAlertIds } } });
      await prisma.agentAlert.deleteMany({ where: { id: { in: createdAlertIds } } });
      createdAlertIds.length = 0;
    }
    if (createdTaskIds.length > 0) {
      await prisma.auditEvent.deleteMany({ where: { taskId: { in: createdTaskIds } } });
      await prisma.recommendation.deleteMany({ where: { taskId: { in: createdTaskIds } } });
      await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
      createdTaskIds.length = 0;
    }
    for (const id of mutatedLaneIds) {
      await prisma.yardLane.update({ where: { id }, data: { blocked: false } });
    }
    mutatedLaneIds.length = 0;
  });

  it("detects a blocked-lane-with-real-impact condition, raises it, and a supervisor applies it end-to-end", async () => {
    const supervisorCookie = await loginCookie("supervisor@cargofusion.demo", "demo1234");

    // 1. Seed the condition: a blocked lane on an active task's own recommended route.
    const lane = await prisma.yardLane.findFirstOrThrow();
    await prisma.yardLane.update({ where: { id: lane.id }, data: { blocked: true } });
    mutatedLaneIds.push(lane.id);

    const container = await prisma.container.findFirstOrThrow({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    const task = await prisma.task.create({
      data: { containerId: container.id, status: "PLANNED", priority: "HIGH", requestedBy: "test-operator" },
    });
    createdTaskIds.push(task.id);
    await prisma.recommendation.create({
      data: {
        taskId: task.id,
        routeJson: JSON.stringify([lane.fromNodeId, lane.toNodeId]),
        equipmentId: "TRUCK-001",
        confidence: 0.9,
        confidenceLevel: "HIGH",
        confidenceFactorsJson: "{}",
        explanation: "",
        twinValidated: true,
      },
    });

    // 2. The agent's own detection: run a real cycle, not a mock (containerManagementAgent
    // is the same module singleton the /api/agent/* routes operate on).
    const raised = await containerManagementAgent.runCycle();
    const alert = raised.find((a) => a.dedupeKey === `blocked-lane:${lane.id}`);
    expect(alert).toBeDefined();
    createdAlertIds.push(...raised.map((a) => a.id));

    expect(alert!.status).toBe("OPEN");
    expect(alert!.type).toBe("BLOCKED_LANE_IMPACT");
    expect(alert!.taskId).toBe(task.id);

    const raisedAuditEvents = await prisma.auditEvent.findMany({ where: { agentAlertId: alert!.id } });
    expect(raisedAuditEvents.map((e) => e.action)).toEqual(["AGENT_ALERT_RAISED"]);
    expect(raisedAuditEvents[0].actor).toBe("agent:container-management-agent");

    // 3. The alert is visible through the same GET the /agent page uses.
    const listResponse = await getAlerts(getRequest("http://localhost/api/agent/alerts", supervisorCookie));
    expect(listResponse.status).toBe(200);
    const listData = await listResponse.json();
    const listedAlert = listData.alerts.find((a: { id: string }) => a.id === alert!.id);
    expect(listedAlert).toBeDefined();
    expect(listedAlert.task?.container?.id).toBe(container.id);

    // 4. A supervisor applies it through the live HTTP route (real session cookie, not a service call).
    const applyResponse = await applyAlert(
      jsonRequest(`http://localhost/api/agent/alerts/${alert!.id}/apply`, {}, supervisorCookie),
      idParams(alert!.id),
    );
    expect(applyResponse.status).toBe(200);
    const applyData = await applyResponse.json();
    expect(applyData.alert.status).toBe("APPLIED");
    expect(applyData.alert.resolvedBy).toBe("supervisor@cargofusion.demo");

    // 5. The underlying deterministic effect actually happened — the exact
    // same effect DemoControls.unblockLane produces, not something bespoke.
    const updatedLane = await prisma.yardLane.findUniqueOrThrow({ where: { id: lane.id } });
    expect(updatedLane.blocked).toBe(false);

    // 6. Full, correctly-attributed audit trail: the original task's own
    // trail is untouched, and the alert has its own trail keyed by agentAlertId.
    const finalAlertAuditEvents = await prisma.auditEvent.findMany({
      where: { agentAlertId: alert!.id },
      orderBy: { createdAt: "asc" },
    });
    expect(finalAlertAuditEvents.map((e) => e.action)).toEqual(["AGENT_ALERT_RAISED", "AGENT_ALERT_APPLIED"]);
    expect(finalAlertAuditEvents[1].actor).toBe("supervisor@cargofusion.demo");

    // AgentAlertService tags both taskId and agentAlertId on these audit
    // rows, so they surface in the task's own audit trail too (a
    // task-centric view, e.g. the dashboard's task detail, would show
    // "an agent flagged and resolved a blocked-lane issue on this task"),
    // not siloed away where only the /agent page could ever see them.
    const taskDetailResponse = await getTaskDetail(new Request(`http://localhost/api/tasks/${task.id}`), idParams(task.id));
    const taskDetail = await taskDetailResponse.json();
    expect(taskDetail.task.container.id).toBe(container.id);
    expect(
      taskDetail.task.auditEvents.map((e: { action: string; agentAlertId: string | null }) => [
        e.action,
        e.agentAlertId,
      ]),
    ).toEqual([
      ["AGENT_ALERT_RAISED", alert!.id],
      ["AGENT_ALERT_APPLIED", alert!.id],
    ]);
  });
});
