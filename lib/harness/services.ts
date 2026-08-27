import { isAbsolute, join, resolve } from "node:path";
import { DynamicHarnessRuntime } from "@/lib/harness/runtime";
import { FileRunStore } from "@/lib/harness/store";

export type HarnessServices = {
  store: FileRunStore;
  runtime: DynamicHarnessRuntime;
};

const shared = globalThis as typeof globalThis & { __dynamicHarnessServices?: HarnessServices };

function dataRoot() {
  const configured = process.env.HARNESS_DATA_ROOT?.trim();
  if (!configured) return join(process.cwd(), ".data");
  return isAbsolute(configured)
    ? configured
    : resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}

export function getHarnessServices(): HarnessServices {
  if (!shared.__dynamicHarnessServices) {
    const store = new FileRunStore({ root: dataRoot() });
    shared.__dynamicHarnessServices = {
      store,
      runtime: new DynamicHarnessRuntime({ store }),
    };
  }
  return shared.__dynamicHarnessServices;
}
