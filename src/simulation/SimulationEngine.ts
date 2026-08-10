import { DemoControls } from "@/simulation/DemoControls";

const DEFAULT_INTERVAL_MS = 4000;

/**
 * Interval-driven background simulation (report section 5: "truck moves
 * between nodes, equipment becomes available/unavailable, congestion
 * changes, RFID checkpoint event occurs"). Deliberately opt-in — never
 * starts itself — so it can't run during tests or an idle dev session; a
 * demo operator starts/stops it explicitly via the dashboard.
 */
export class SimulationEngine {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly controls: DemoControls;

  constructor(controls: DemoControls = new DemoControls()) {
    this.controls = controls;
  }

  start(intervalMs: number = DEFAULT_INTERVAL_MS): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      this.tick().catch((err) => console.error("Simulation tick failed:", err));
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  isRunning(): boolean {
    return this.intervalId !== null;
  }

  /** One simulated "moment" of yard activity — a random subset of possible events, not all of them. */
  async tick(): Promise<void> {
    const roll = Math.random();
    if (roll < 0.4) {
      await this.controls.moveEquipment();
    } else if (roll < 0.7) {
      await this.controls.driftCongestion();
    } else if (roll < 0.85) {
      await this.controls.flapRandomEquipmentAvailability();
    } else {
      await this.controls.triggerRfidEvent();
    }
  }
}

// Module-level singleton: the Next.js dev server is one long-lived Node
// process, so start/stop state needs to survive across API route
// invocations (each request re-imports the module, but Node caches it).
export const simulationEngine = new SimulationEngine();
