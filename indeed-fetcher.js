require('dotenv').config();

async function fetchIndeedJobs(role, skills, city) {
  const publisherId = process.env.INDEED_PUBLISHER_ID;
  if (!publisherId) throw new Error('INDEED_PUBLISHER_ID not set');

  const query = [role, skills].filter(Boolean).join(' ');
  const params = new URLSearchParams({
    publisher: publisherId,
    q: query,
    l: city || '',
    sort: 'date',
    fromage: '3',
    limit: '25',
    co: 'in',
    format: 'json',
    v: '2',
  });

  const url = `https://api.indeed.com/ads/apisearch?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Indeed API HTTP ${res.status}`);
  const json = await res.json();

  return (json.results || []).map(j => ({
    jobkey: j.jobkey,
    job_id: `indeed_${j.jobkey}`,
    title: j.jobtitle || '',
    company: j.company || '',
    location: j.formattedLocation || '',
    url: j.url || '',
    snippet: j.snippet || '',
    date: j.date || '',
    created_utc: j.date ? new Date(j.date).getTime() / 1000 : Date.now() / 1000,
  }));
}

module.exports = { fetchIndeedJobs };
