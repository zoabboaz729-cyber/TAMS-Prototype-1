import { redirect } from "next/navigation";
import { VenueForm } from "@/components/venues/VenueForm";
import { decideVenueWrite } from "@/domain/venueRules";
import { ownerOptionsFor } from "@/domain/venueOwnerOptions";
import { venueFormValuesFromStored } from "@/server/venueFormView";
import { loadDepartments } from "@/server/venueData";
import { createPrismaVenueStore } from "@/server/venueStorePrisma";
import { requireAnyAction } from "@/server/guards";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditVenuePage({ params }: PageProps) {
  const { id } = await params;
  const user = await requireAnyAction("DECLARE_VENUE");
  if (id.length > 100) redirect("/venues?notice=not_found");

  const venue = await createPrismaVenueStore().findVenue(id);
  if (venue === null) redirect("/venues?notice=not_found");

  const current = { ownerDepartmentId: venue.ownerDepartmentId };
  if (
    decideVenueWrite(
      user,
      "EDIT",
      current,
      venue.ownerDepartmentId,
    ).status !== "ALLOW"
  ) {
    redirect("/forbidden");
  }

  const departments = await loadDepartments();
  const ownerOptions = ownerOptionsFor(user, departments, "EDIT", current);
  if (ownerOptions.length === 0) redirect("/forbidden");

  return (
    <main className="min-h-[calc(100vh-8rem)] p-4 sm:p-6">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-xl font-bold text-slate-800">
          Edit venue {venue.code}
        </h1>
        <VenueForm
          mode="EDIT"
          venueId={venue.id}
          ownerOptions={ownerOptions}
          initialValues={venueFormValuesFromStored(venue)}
          cancelHref="/venues"
        />
      </div>
    </main>
  );
}
