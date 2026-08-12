import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { createRng, pick, randInt, shuffle, type Rng } from "../src/domain/seed/rng";
import { LANE_SCALE_METERS } from "../src/domain/constants";
import { hashPassword } from "../src/auth/passwords";

/** Fixed demo password for every seeded User — documented in .env.example/README, not a real secret. */
const DEMO_PASSWORD = "demo1234";

/**
 * Synthetic terminal dataset generator (Phase 3). Deterministic from SEED so
 * demos and tests are reproducible (report brief section 14). Not meant to
 * model real physics — just realistic-looking scale and shape.
 */
const SEED = 42;
const NUM_CONTAINERS = 1200;
const NUM_YARD_TRUCKS = 90;
const NUM_CRANES = 20;
const NUM_WORKERS = 40;

const BLOCK_IDS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"] as const;
const BLOCK_COLS = 5; // blocks arranged in a 2-row x 5-col yard layout
const ROWS_PER_BLOCK = 6;
const BAYS_PER_BLOCK = 24;
const TIERS_PER_BLOCK = 4;

const OWNER_CODES = [
  "MSKU",
  "MAEU",
  "CMAU",
  "HLXU",
  "OOLU",
  "EGHU",
  "TCLU",
  "CSNU",
] as const;
const DESTINATIONS = [
  "Rotterdam",
  "Singapore",
  "Shanghai",
  "Los Angeles",
  "Hamburg",
  "Dubai",
  "Busan",
  "Antwerp",
  "Colombo",
  "Mumbai (JNPT)",
] as const;
const CONTAINER_TYPES = ["DRY", "DRY", "DRY", "REEFER", "TANK", "OPEN_TOP", "FLAT_RACK"] as const;
const CONTAINER_STATUSES = [
  "IN_YARD",
  "IN_YARD",
  "IN_YARD",
  "IN_YARD",
  "RESERVED",
  "DISPATCHED",
  "RETRIEVED",
  "DEPARTED",
] as const;
const PRIORITIES = ["LOW", "LOW", "MEDIUM", "MEDIUM", "MEDIUM", "HIGH", "URGENT"] as const;

function containerId(rng: Rng, used: Set<string>): string {
  let id: string;
  do {
    const owner = pick(rng, OWNER_CODES);
    const digits = String(randInt(rng, 0, 9_999_999)).padStart(7, "0");
    id = `${owner}${digits}`;
  } while (used.has(id));
  used.add(id);
  return id;
}

function buildYardGraph() {
  type NodeDef = { id: string; blockId: string | null; x: number; y: number };
  type LaneDef = { fromNodeId: string; toNodeId: string; distanceMeters: number };

  const nodes: NodeDef[] = [{ id: "GATE", blockId: null, x: -1, y: 0.5 }];
  const lanes: LaneDef[] = [];

  const dist = (a: NodeDef, b: NodeDef) =>
    Math.hypot(a.x - b.x, a.y - b.y) * LANE_SCALE_METERS;

  // Horizontal spine, one node per column, connecting the gate to every column.
  const spine: NodeDef[] = [];
  for (let col = 0; col < BLOCK_COLS; col++) {
    const node: NodeDef = { id: `SPINE-${col}`, blockId: null, x: col, y: 0.5 };
    spine.push(node);
    nodes.push(node);
  }
  lanes.push({
    fromNodeId: "GATE",
    toNodeId: spine[0].id,
    distanceMeters: dist(nodes[0], spine[0]),
  });
  for (let col = 0; col < BLOCK_COLS - 1; col++) {
    lanes.push({
      fromNodeId: spine[col].id,
      toNodeId: spine[col + 1].id,
      distanceMeters: dist(spine[col], spine[col + 1]),
    });
  }

  // Two block rows (row 0 above the spine, row 1 below), each block entry
  // connected to the spine node in its column.
  const rowEntries: NodeDef[][] = [[], []];
  BLOCK_IDS.forEach((blockId, i) => {
    const col = i % BLOCK_COLS;
    const row = Math.floor(i / BLOCK_COLS); // 0 or 1
    const y = row === 0 ? 0 : 1;
    const entry: NodeDef = { id: `BLOCK-${blockId}-ENTRY`, blockId, x: col, y };
    nodes.push(entry);
    rowEntries[row].push(entry);
    lanes.push({
      fromNodeId: spine[col].id,
      toNodeId: entry.id,
      distanceMeters: dist(spine[col], entry),
    });
  });

  // Lateral aisle lanes between adjacent block entries in the same row.
  // Without these the graph is a pure tree (one path between any two
  // points), so a blocked lane would just strand whatever is past it
  // instead of triggering a reroute — these give A* (Phase 6) real
  // alternate routes to choose during the congestion/blocked-lane demo.
  for (const entries of rowEntries) {
    for (let i = 0; i < entries.length - 1; i++) {
      lanes.push({
        fromNodeId: entries[i].id,
        toNodeId: entries[i + 1].id,
        distanceMeters: dist(entries[i], entries[i + 1]),
      });
    }
  }

  return { nodes, lanes };
}

async function main() {
  const rng = createRng(SEED);
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  });
  const prisma = new PrismaClient({ adapter });

  console.log(`Seeding with SEED=${SEED} ...`);

  // Clear in FK-safe order.
  await prisma.auditEvent.deleteMany();
  await prisma.agentAlert.deleteMany();
  await prisma.tosWriteBackLog.deleteMany();
  await prisma.recommendation.deleteMany();
  await prisma.task.deleteMany();
  await prisma.sensorEvent.deleteMany();
  await prisma.user.deleteMany(); // must precede Worker (User.workerId -> Worker.id)
  await prisma.equipment.deleteMany();
  await prisma.container.deleteMany();
  await prisma.worker.deleteMany();
  await prisma.yardLane.deleteMany();
  await prisma.yardNode.deleteMany();
  await prisma.yardBlock.deleteMany();

  // Yard blocks + graph.
  await prisma.yardBlock.createMany({
    data: BLOCK_IDS.map((id) => ({ id, name: `Block ${id}` })),
  });
  const { nodes, lanes } = buildYardGraph();
  for (const node of nodes) {
    await prisma.yardNode.create({ data: node });
  }
  await prisma.yardLane.createMany({
    data: lanes.map((l) => ({ ...l, blocked: false, congestionWeight: 1.0 })),
  });
  console.log(`Yard graph: ${nodes.length} nodes, ${lanes.length} lanes.`);

  // Equipment: cranes near block entries, trucks scattered across all nodes.
  const equipmentData: {
    id: string;
    type: "CRANE" | "YARD_TRUCK";
    status: "AVAILABLE" | "BUSY" | "OFFLINE";
    capacityKg: number;
    currentNodeId: string;
  }[] = [];
  const blockEntryNodes = nodes.filter((n) => n.blockId !== null);
  for (let i = 0; i < NUM_CRANES; i++) {
    equipmentData.push({
      id: `CRANE-${String(i + 1).padStart(3, "0")}`,
      type: "CRANE",
      status: rng() < 0.85 ? "AVAILABLE" : rng() < 0.5 ? "BUSY" : "OFFLINE",
      capacityKg: pick(rng, [40000, 50000, 65000]),
      currentNodeId: pick(rng, blockEntryNodes).id,
    });
  }
  for (let i = 0; i < NUM_YARD_TRUCKS; i++) {
    equipmentData.push({
      id: `TRUCK-${String(i + 1).padStart(3, "0")}`,
      type: "YARD_TRUCK",
      status: rng() < 0.75 ? "AVAILABLE" : rng() < 0.5 ? "BUSY" : "OFFLINE",
      capacityKg: pick(rng, [20000, 30000, 35000]),
      currentNodeId: pick(rng, nodes).id,
    });
  }
  await prisma.equipment.createMany({ data: equipmentData });
  console.log(`Equipment: ${equipmentData.length} (${NUM_CRANES} cranes, ${NUM_YARD_TRUCKS} trucks).`);

  // Containers: unique slot per block via a shuffled slot list, so positions
  // don't collide within a block.
  const usedIds = new Set<string>();
  const perBlock = Math.ceil(NUM_CONTAINERS / BLOCK_IDS.length);
  let created = 0;
  for (const blockId of BLOCK_IDS) {
    const allSlots: { row: number; bay: number; tier: number }[] = [];
    for (let row = 1; row <= ROWS_PER_BLOCK; row++) {
      for (let bay = 1; bay <= BAYS_PER_BLOCK; bay++) {
        for (let tier = 1; tier <= TIERS_PER_BLOCK; tier++) {
          allSlots.push({ row, bay, tier });
        }
      }
    }
    const slots = shuffle(rng, allSlots).slice(0, perBlock);
    const batch = slots.map((slot) => {
      const status = pick(rng, CONTAINER_STATUSES);
      return {
        id: containerId(rng, usedIds),
        block: blockId,
        row: slot.row,
        bay: slot.bay,
        tier: slot.tier,
        status,
        priority: pick(rng, PRIORITIES),
        type: pick(rng, CONTAINER_TYPES),
        weightKg: randInt(rng, 4000, 30000),
        destination: pick(rng, DESTINATIONS),
        retrievalEligible: status !== "DEPARTED" && status !== "RETRIEVED",
      };
    });
    if (created + batch.length > NUM_CONTAINERS) {
      batch.length = Math.max(0, NUM_CONTAINERS - created);
    }
    if (batch.length > 0) {
      await prisma.container.createMany({ data: batch });
      created += batch.length;
    }
    if (created >= NUM_CONTAINERS) break;
  }
  console.log(`Containers: ${created}.`);

  // Workers.
  const workerData = Array.from({ length: NUM_WORKERS }, (_, i) => ({
    id: `WORKER-${String(i + 1).padStart(3, "0")}`,
    name: `Yard Worker ${i + 1}`,
    status: pick(rng, ["AVAILABLE", "AVAILABLE", "AVAILABLE", "BUSY", "OFF_SHIFT"] as const),
  }));
  await prisma.worker.createMany({ data: workerData });
  console.log(`Workers: ${workerData.length}.`);

  // Demo users — one per role, WORKER accounts bound to real seeded Worker
  // rows so the worker app's session.workerId resolves to actual data.
  const demoPasswordHash = await hashPassword(DEMO_PASSWORD);
  await prisma.user.createMany({
    data: [
      { email: "operator@cargofusion.demo", name: "Demo Operator", role: "OPERATOR", passwordHash: demoPasswordHash },
      {
        email: "supervisor@cargofusion.demo",
        name: "Demo Supervisor",
        role: "SUPERVISOR",
        passwordHash: demoPasswordHash,
      },
      {
        email: "worker1@cargofusion.demo",
        name: "Yard Worker 1",
        role: "WORKER",
        passwordHash: demoPasswordHash,
        workerId: workerData[0].id,
      },
      {
        email: "worker2@cargofusion.demo",
        name: "Yard Worker 2",
        role: "WORKER",
        passwordHash: demoPasswordHash,
        workerId: workerData[1].id,
      },
      {
        email: "worker3@cargofusion.demo",
        name: "Yard Worker 3",
        role: "WORKER",
        passwordHash: demoPasswordHash,
        workerId: workerData[2].id,
      },
    ],
  });
  console.log(`Demo users: 5 (operator, supervisor, 3 workers) — password "${DEMO_PASSWORD}" for all.`);

  await prisma.$disconnect();
  console.log("Seed complete.");
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
