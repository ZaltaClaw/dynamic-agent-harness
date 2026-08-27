import HarnessStudio from "@/components/studio/harness-studio";
import { defaultHarnessSpec } from "@/lib/harness/schema";

export default function Home() {
  return <HarnessStudio initialSpec={defaultHarnessSpec} />;
}
