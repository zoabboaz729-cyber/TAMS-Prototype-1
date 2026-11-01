"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { createPrismaVenueStore } from "@/server/venueStorePrisma";
import { performVenueWrite } from "@/server/venueWrite";
import type { VenueFormState } from "@/server/venueSubmission";
import { venueRequestFromFormData } from "@/server/venueSubmission";
import { isSameOriginRequest } from "@/server/origin";

export async function saveVenueAction(
  _prev: VenueFormState,
  formData: FormData,
): Promise<VenueFormState> {
  const requestHeaders = await headers();
  if (
    !isSameOriginRequest({
      origin: requestHeaders.get("origin"),
      host: requestHeaders.get("host"),
      secFetchSite: requestHeaders.get("sec-fetch-site"),
    })
  ) {
    return {
      errors: {},
      values: {
        code: "",
        type: "",
        capacity: "",
        status: "",
        owner: "",
        facilities: [],
      },
      formError: "This request was rejected. Reload the page and try again.",
    };
  }

  const user = await getCurrentUser();
  if (user === null) redirect("/login");

  const submission = venueRequestFromFormData(formData);
  if (!submission.ok) {
    return {
      errors: {},
      values: submission.values,
      formError: "The form was incomplete. Please check it and try again.",
    };
  }

  let result: Awaited<ReturnType<typeof performVenueWrite>>;
  try {
    result = await performVenueWrite(
      createPrismaVenueStore(),
      user,
      submission.request,
    );
  } catch (error) {
    console.error(
      "[venues] save failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return {
      errors: {},
      values: submission.values,
      formError: "Something went wrong and nothing was saved. Please try again.",
    };
  }

  if (result.ok) {
    revalidatePath("/venues");
    if (submission.request.op === "CREATE") {
      redirect("/venues?notice=created");
    }
    if (result.changed) redirect("/venues?notice=updated");
    redirect("/venues?notice=unchanged");
  }

  switch (result.kind) {
    case "UNAUTHENTICATED":
      redirect("/login");
    case "FORBIDDEN":
      redirect("/forbidden");
    case "NOT_FOUND":
      redirect("/venues?notice=not_found");
    case "VALIDATION":
      return { errors: result.errors, values: submission.values };
  }
}
