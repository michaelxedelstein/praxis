import type { PraxisBridge } from "../../shared/ipc";

declare global {
  interface Window {
    praxis: PraxisBridge;
  }
}

export {};
