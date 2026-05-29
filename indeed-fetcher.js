require('dotenv').config();

async function fetchIndeedJobs(role, skills, city) {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) throw new Error('ADZUNA_APP_ID and ADZUNA_APP_KEY must be set');

  const query = [role, skills].filter(Boolean).join(' ');
  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    what: query,
    where: city || '',
    results_per_page: '25',
    sort_by: 'date',
  });

  const url = `https://api.adzuna.com/v1/api/jobs/in/search/1?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Adzuna API HTTP ${res.status}`);
  const json = await res.json();

  return (json.results || []).map(j => ({
    job_id: `adzuna_${j.id}`,
    title: j.title || '',
    company: j.company?.display_name || '',
    location: j.location?.display_name || '',
    url: j.redirect_url || '',
    snippet: j.description || '',
    date: j.created || '',
    created_utc: j.created ? new Date(j.created).getTime() / 1000 : Date.now() / 1000,
  }));
}

module.exports = { fetchIndeedJobs };
