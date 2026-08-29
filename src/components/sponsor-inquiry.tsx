"use client";

import { FormEvent, useRef, useState } from "react";

type SponsorInquiryProps = {
  sessionReady: boolean;
};

type InquiryResult = {
  id: string;
  status: string;
  createdAt: string;
};

const initialForm = {
  companyName: "",
  contactName: "",
  contactEmail: "",
  companyWebsite: "",
  destinationUrl: "",
  creativeType: "VIDEO",
  creativeUrl: "",
  campaignTitle: "",
  description: "",
  authorizationConfirmed: false,
};

export function SponsorInquiry({ sessionReady }: SponsorInquiryProps) {
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InquiryResult | null>(null);
  const requestId = useRef(crypto.randomUUID());

  function updateField(field: Exclude<keyof typeof initialForm, "authorizationConfirmed">, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submitInquiry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionReady || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/sponsor-inquiries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, clientRequestId: requestId.current }),
      });
      const body = (await response.json()) as { inquiry?: InquiryResult; error?: string };
      if (!response.ok || !body.inquiry) throw new Error(body.error ?? "SPONSOR_INQUIRY_FAILED");
      setResult(body.inquiry);
      setForm(initialForm);
      requestId.current = crypto.randomUUID();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "SPONSOR_INQUIRY_FAILED");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="sponsor-intake" id="for-sponsors" aria-labelledby="sponsor-intake-title">
      <div className="sponsor-intake-copy">
        <p className="eyebrow">FOR SPONSORS</p>
        <h2 id="sponsor-intake-title">Fund useful work with one clear sponsor moment.</h2>
        <p>
          Send us your campaign idea and a public link to the creative. Every request is reviewed
          before pricing, funding, or publication.
        </p>
        <ol>
          <li><span>01</span>Share the company, message, creative, and destination.</li>
          <li><span>02</span>ComputeQuest verifies authorization, fit, reward, and campaign capacity.</li>
          <li><span>03</span>An approved campaign receives its own funded Monad settlement identity.</li>
        </ol>
      </div>

      <form className="sponsor-intake-form" onSubmit={submitInquiry}>
        <div className="sponsor-field-grid">
          <label>
            COMPANY
            <input maxLength={100} minLength={2} onChange={(event) => updateField("companyName", event.target.value)} required value={form.companyName} />
          </label>
          <label>
            CONTACT NAME
            <input autoComplete="name" maxLength={100} minLength={2} onChange={(event) => updateField("contactName", event.target.value)} required value={form.contactName} />
          </label>
          <label>
            CONTACT EMAIL
            <input autoComplete="email" maxLength={254} onChange={(event) => updateField("contactEmail", event.target.value)} required type="email" value={form.contactEmail} />
          </label>
          <label>
            COMPANY WEBSITE
            <input maxLength={500} onChange={(event) => updateField("companyWebsite", event.target.value)} placeholder="https://company.com" required type="url" value={form.companyWebsite} />
          </label>
          <label>
            CAMPAIGN DESTINATION
            <input maxLength={500} onChange={(event) => updateField("destinationUrl", event.target.value)} placeholder="https://company.com/product" required type="url" value={form.destinationUrl} />
          </label>
          <label>
            CREATIVE FORMAT
            <select onChange={(event) => updateField("creativeType", event.target.value)} value={form.creativeType}>
              <option value="VIDEO">Video</option>
              <option value="X_POST">X post</option>
              <option value="IMAGE">Image</option>
              <option value="OTHER">Other public link</option>
            </select>
          </label>
          <label>
            CREATIVE LINK
            <input maxLength={500} onChange={(event) => updateField("creativeUrl", event.target.value)} placeholder="https://..." required type="url" value={form.creativeUrl} />
          </label>
        </div>
        <label>
          CAMPAIGN TITLE
          <input maxLength={80} minLength={3} onChange={(event) => updateField("campaignTitle", event.target.value)} required value={form.campaignTitle} />
        </label>
        <label>
          SHORT DESCRIPTION
          <textarea
            maxLength={280}
            minLength={20}
            onChange={(event) => updateField("description", event.target.value)}
            placeholder="What should the user understand or do after this sponsor moment?"
            required
            value={form.description}
          />
          <small>{form.description.length} / 280</small>
        </label>
        <p className="sponsor-intake-note">
          Submit public HTTPS links only. A request does not authorize ComputeQuest to publish the creative or spend sponsor funds.
        </p>
        <label className="sponsor-consent">
          <input
            checked={form.authorizationConfirmed}
            onChange={(event) => setForm((current) => ({ ...current, authorizationConfirmed: event.target.checked }))}
            required
            type="checkbox"
          />
          <span>I represent this company or have permission to share this creative for campaign review.</span>
        </label>
        <button disabled={!sessionReady || submitting} type="submit">
          {submitting ? "SENDING REQUEST…" : sessionReady ? "REQUEST CAMPAIGN REVIEW" : "CONNECTING SECURE SESSION…"}
        </button>
        {result ? (
          <div className="sponsor-intake-success" role="status">
            <strong>REQUEST RECEIVED</strong>
            <span>Reference {result.id.slice(0, 8).toLocaleUpperCase("en-US")}</span>
            <p>We will use the contact email you provided to discuss authorization, budget, and campaign setup.</p>
          </div>
        ) : null}
        {error ? <p className="sponsor-intake-error" role="alert">{formatInquiryError(error)}</p> : null}
      </form>
    </section>
  );
}

function formatInquiryError(error: string) {
  if (error === "SPONSOR_INQUIRY_RATE_LIMITED") return "This session has reached the daily request limit. Contact us after 24 hours.";
  if (error === "SESSION_REQUIRED") return "Your secure session expired. Refresh the page and try again.";
  return "We could not save this request. Check every field and use public HTTPS links before trying again.";
}
