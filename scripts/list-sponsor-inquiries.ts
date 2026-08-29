import { closeDatabase } from "../src/server/db/client";
import { requireDatabaseEnv } from "../src/server/env";
import { listSponsorInquiriesForOperator } from "../src/server/services/sponsor-inquiries";

async function main() {
  requireDatabaseEnv();
  try {
    const inquiries = await listSponsorInquiriesForOperator();
    if (inquiries.length === 0) {
      console.log("No sponsor inquiries received.");
      return;
    }
    console.table(
      inquiries.map((inquiry) => ({
        id: inquiry.id,
        status: inquiry.status,
        company: inquiry.companyName,
        contact: `${inquiry.contactName} <${inquiry.contactEmail}>`,
        website: inquiry.companyWebsite,
        destination: inquiry.destinationUrl,
        creativeType: inquiry.creativeType,
        creativeUrl: inquiry.creativeUrl,
        title: inquiry.campaignTitle,
        description: inquiry.description,
        receivedAt: inquiry.createdAt.toISOString(),
      })),
    );
  } finally {
    await closeDatabase();
  }
}

void main();
