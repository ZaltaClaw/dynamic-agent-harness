import HarnessChat from "@/components/site/harness-chat";
import { defaultHarnessSpec } from "@/lib/harness/schema";

export default function Home() {
  return <HarnessChat initialSpec={defaultHarnessSpec} />;
}
