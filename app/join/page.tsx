import { clubs } from "@/lib/queries";
import { JoinForm } from "./form";

export default function Join() {
  return (
    <div>
      <h1 className="text-[48px]">Create your profile</h1>
      <p className="mb-8 mt-1 text-muted">Takes a minute. You can add results straight after.</p>
      <JoinForm clubs={clubs().map((c) => ({ id: c.id, name: c.name }))} />
    </div>
  );
}
