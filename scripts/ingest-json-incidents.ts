import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient({
  log: ['warn', 'error'],
});

async function main() {
  console.log('Connecting to Neon database...');
  await prisma.$connect();
  console.log('Connected successfully!');

  const filePath = path.join(__dirname, '../data/incidents-batch.json');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Data file not found at ${filePath}`);
  }

  const incidents = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  console.log(`Starting ingestion of ${incidents.length} incidents into Neon...`);

  for (const item of incidents) {
    // 1. Ensure all referenced organizations exist
    const orgMap = new Map<string, string>();
    for (const org of item.organizations) {
      const existing = await prisma.organization.upsert({
        where: { name: org.name },
        update: { type: org.type, url: org.url },
        create: {
          name: org.name,
          type: org.type,
          url: org.url,
          reliabilityScore: 4.5,
        },
      });
      orgMap.set(org.name, existing.id);
    }

    // 2. Prepare incident claims linked to organizations
    const claimsData = (item.claims || []).map((claim: any) => ({
      organizationId: orgMap.get(claim.organizationName)!,
      reportedDead: claim.reportedDead ?? null,
      reportedMissing: claim.reportedMissing ?? null,
      reportedSurvivors: claim.reportedSurvivors ?? null,
      summary: claim.summary,
      sourceUrl: claim.sourceUrl,
    }));

    // 3. Prepare evidence and leaks
    const evidenceData = (item.evidenceAndLeaks || []).map((ev: any) => ({
      type: ev.type,
      title: ev.title,
      description: ev.description,
      submittedBy: ev.submittedBy,
      fileUrl: ev.fileUrl,
      isVerified: true,
    }));

    // 4. Create or update the Incident row
    const incident = await prisma.incident.create({
      data: {
        incidentDate: new Date(item.date),
        location: item.location,
        latitude: item.coordinates.latitude,
        longitude: item.coordinates.longitude,
        route: item.route,
        vesselType: item.vesselType,
        totalDead: item.totalDead,
        totalMissing: item.totalMissing,
        totalSurvivors: item.totalSurvivors,
        demographics: item.demographics,
        contradictionNotes: item.contradictions,
        claims: {
          create: claimsData,
        },
        evidence: {
          create: evidenceData,
        },
      },
    });

    console.log(`✓ Inserted incident: ${incident.id} (${item.date} - ${item.location})`);
  }

  console.log('Ingestion finished successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });