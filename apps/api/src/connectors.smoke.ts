import { fetchSourceJobs } from "./connectors.js";
import { assessListing } from "./job-filter.js";
import { calculateMatch } from "./matching.js";
import { loadPrivateProfile } from "./profile.js";
import { VERIFIED_SOURCES } from "./search.js";

const profile = await loadPrivateProfile();
const results = await Promise.all(VERIFIED_SOURCES.map(async (source) => {
  try {
    const jobs = await fetchSourceJobs({
      id: "smoke", provider: source.provider, companyName: source.company_name,
      boardToken: source.board_token, region: source.region,
    });
    const matching = jobs.filter((job) => assessListing(job).relevant);
    return {
      company: source.company_name, provider: source.provider, activePostings: jobs.length,
      matchingRoles: matching.length,
      examples: matching.slice(0, 2).map((job) => ({
        title: job.title, location: job.location, sourceUrl: job.sourceUrl,
        matchScore: calculateMatch(profile, {
          title: job.title, company: job.company, description: job.description,
          sourceUrl: job.sourceUrl, location: job.location, workMode: job.workMode, postedAt: job.publishedAt,
        }).realScore,
      })),
    };
  } catch (error) {
    return { company: source.company_name, provider: source.provider, error: error instanceof Error ? error.message : "Unknown error" };
  }
}));

console.log(JSON.stringify(results, null, 2));
if (!results.some((result) => "activePostings" in result && result.activePostings > 0)) process.exitCode = 1;
