import { redirect } from "next/navigation";
import { VenueForm } from "@/components/venues/VenueForm";
import { ownerOptionsFor } from "@/domain/venueOwnerOptions";
import { emptyVenueFormValues } from "@/server/venueFormView";
import { loadDepartments } from "@/server/venueData";
import { requireAnyAction } from "@/server/guards";

export default async function NewVenuePage() {
  const user = await requireAnyAction("DECLARE_VENUE");
  const departments = await loadDepartments();
  const ownerOptions = ownerOptionsFor(user, departments, "CREATE", null);
  if (ownerOptions.length === 0) redirect("/forbidden");

  const initialValues = emptyVenueFormValues(
    ownerOptions.length === 1 ? ownerOptions[0]?.value ?? "" : "",
  );

  return (
    <main className="min-h-[calc(100vh-8rem)] p-4 sm:p-6">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-xl font-bold text-slate-800">Add venue</h1>
        <p className="mt-1 text-sm text-slate-600">
          Enter the venue details and choose an owner you are permitted to manage.
        </p>
        <VenueForm
          mode="CREATE"
          ownerOptions={ownerOptions}
          initialValues={initialValues}
          cancelHref="/venues"
        />
      </div>
    </main>
  );
}
