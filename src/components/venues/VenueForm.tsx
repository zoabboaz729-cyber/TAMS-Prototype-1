"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveVenueAction } from "@/app/venues/actions";
import type { OwnerOption } from "@/domain/venueOwnerOptions";
import { VENUE_STATUSES, VENUE_TYPES } from "@/domain/types";
import { ALLOWED_FACILITIES } from "@/domain/venueSchema";
import type { VenueFormValues } from "@/server/venueSubmission";

const FIELD_CLASS =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
const LABEL_CLASS = "mb-1 block text-sm font-medium text-slate-700";
const ERROR_CLASS = "mt-1 text-sm text-red-700";
const BUTTON_CLASS =
  "rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60";
const CANCEL_CLASS =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1";

type Props = {
  mode: "CREATE" | "EDIT";
  venueId?: string;
  ownerOptions: OwnerOption[];
  initialValues: VenueFormValues;
  cancelHref: string;
};

export function VenueForm({
  mode,
  venueId,
  ownerOptions,
  initialValues,
  cancelHref,
}: Props) {
  const [state, formAction, isPending] = useActionState(saveVenueAction, null);
  const values = state?.values ?? initialValues;
  const errors = state?.errors ?? {};
  const matchingOwner = ownerOptions.find(
    (option) => option.value === values.owner,
  );
  const selectedOwner =
    matchingOwner?.value ??
    (ownerOptions.length === 1 ? ownerOptions[0]?.value ?? "" : "");

  return (
    <form action={formAction} noValidate className="mt-6 max-w-2xl space-y-5">
      <input type="hidden" name="op" value={mode} />
      {mode === "EDIT" && (
        <input type="hidden" name="venueId" value={venueId ?? ""} />
      )}

      {state?.formError && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {state.formError}
        </div>
      )}

      <div>
        <label htmlFor="code" className={LABEL_CLASS}>
          Code
        </label>
        <input
          id="code"
          name="code"
          type="text"
          maxLength={10}
          defaultValue={values.code}
          className={FIELD_CLASS}
          aria-invalid={errors.code !== undefined}
          aria-describedby={errors.code ? "code-error" : undefined}
        />
        {errors.code && (
          <p id="code-error" className={ERROR_CLASS}>
            {errors.code}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="type" className={LABEL_CLASS}>
          Type
        </label>
        <select
          id="type"
          name="type"
          defaultValue={values.type}
          className={FIELD_CLASS}
          aria-invalid={errors.type !== undefined}
          aria-describedby={errors.type ? "type-error" : undefined}
        >
          {VENUE_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        {errors.type && (
          <p id="type-error" className={ERROR_CLASS}>
            {errors.type}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="capacity" className={LABEL_CLASS}>
          Capacity
        </label>
        <input
          id="capacity"
          name="capacity"
          type="text"
          inputMode="numeric"
          defaultValue={values.capacity}
          className={FIELD_CLASS}
          aria-invalid={errors.capacity !== undefined}
          aria-describedby={errors.capacity ? "capacity-error" : undefined}
        />
        {errors.capacity && (
          <p id="capacity-error" className={ERROR_CLASS}>
            {errors.capacity}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="status" className={LABEL_CLASS}>
          Status
        </label>
        <select
          id="status"
          name="status"
          defaultValue={values.status}
          className={FIELD_CLASS}
          aria-invalid={errors.status !== undefined}
          aria-describedby={errors.status ? "status-error" : undefined}
        >
          {VENUE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        {errors.status && (
          <p id="status-error" className={ERROR_CLASS}>
            {errors.status}
          </p>
        )}
      </div>

      <fieldset
        aria-invalid={errors.facilities !== undefined}
        aria-describedby={
          errors.facilities ? "facilities-error" : undefined
        }
      >
        <legend className={LABEL_CLASS}>Facilities</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {ALLOWED_FACILITIES.map((facility) => (
            <label key={facility} className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                name="facilities"
                value={facility}
                defaultChecked={values.facilities.includes(facility)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                aria-invalid={errors.facilities !== undefined}
                aria-describedby={
                  errors.facilities ? "facilities-error" : undefined
                }
              />
              {facility}
            </label>
          ))}
        </div>
        {errors.facilities && (
          <p id="facilities-error" className={ERROR_CLASS}>
            {errors.facilities}
          </p>
        )}
      </fieldset>

      <div>
        <label htmlFor="owner" className={LABEL_CLASS}>
          Owner
        </label>
        {ownerOptions.length === 0 ? (
          <p className="text-sm text-slate-600">
            You cannot assign an owner for this venue.
          </p>
        ) : (
          <>
            <select
              id="owner"
              name="owner"
              defaultValue={selectedOwner}
              className={FIELD_CLASS}
              aria-invalid={errors.owner !== undefined}
              aria-describedby={errors.owner ? "owner-error" : undefined}
            >
              {ownerOptions.length > 1 && (
                <option value="" disabled>
                  Choose an owner
                </option>
              )}
              {ownerOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {errors.owner && (
              <p id="owner-error" className={ERROR_CLASS}>
                {errors.owner}
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {ownerOptions.length > 0 && (
          <button type="submit" disabled={isPending} className={BUTTON_CLASS}>
            {isPending
              ? "Saving..."
              : mode === "CREATE"
                ? "Create venue"
                : "Save changes"}
          </button>
        )}
        <Link href={cancelHref} className={CANCEL_CLASS}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
