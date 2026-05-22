const CITY_SUBREDDIT_MAP = {
  'Delhi': ['delhi', 'DelhiNCR'],
  'Noida': ['noida', 'DelhiNCR'],
  'Gurugram': ['gurugram', 'DelhiNCR'],
  'Faridabad': ['Faridabad'],
  'Ghaziabad': ['Ghaziabad'],
  'Mumbai': ['mumbai'],
  'Pune': ['pune'],
  'Bengaluru': ['bangalore'],
  'Hyderabad': ['hyderabad'],
  'Chennai': ['Chennai'],
  'Kolkata': ['kolkata'],
  'Ahmedabad': ['ahmedabad'],
  'Surat': ['surat'],
  'Jaipur': ['jaipur'],
  'Lucknow': ['lucknow'],
  'Chandigarh': ['chandigarh'],
  'Bhopal': ['bhopal'],
  'Indore': ['indore'],
  'Nagpur': ['nagpur'],
  'Patna': ['patna'],
  'Coimbatore': ['Coimbatore'],
  'Kochi': ['Kerala'],
  'Thiruvananthapuram': ['Kerala'],
  'Bhubaneswar': ['bhubaneswar'],
};

const STATE_SUBREDDIT_MAP = {
  'Haryana': ['haryana'],
  'Gujarat': ['gujarat'],
  'Rajasthan': ['rajasthan'],
  'Uttar Pradesh': ['lucknow'],
  'Maharashtra': ['mumbai'],
  'Karnataka': ['bangalore'],
  'Tamil Nadu': ['Chennai'],
  'Telangana': ['hyderabad'],
  'Andhra Pradesh': ['andhra'],
  'West Bengal': ['kolkata'],
  'Kerala': ['Kerala'],
  'Madhya Pradesh': ['bhopal'],
  'Bihar': ['bihar'],
  'Odisha': ['bhubaneswar'],
  'Punjab': ['chandigarh'],
  'Himachal Pradesh': ['himachal'],
  'Uttarakhand': ['uttarakhand'],
  'Jharkhand': ['jharkhand'],
  'Chhattisgarh': ['chhattisgarh'],
  'Assam': ['assam'],
  'Delhi (NCT)': ['delhi', 'DelhiNCR'],
  'Chandigarh': ['chandigarh'],
  'Jammu and Kashmir': ['jammukashmir'],
  'Goa': ['goa'],
};

const INDIA_FALLBACK_SUBREDDITS = [
  'india',
  'indianbusiness',
  'IndiaInvestments',
  'Entrepreneur_india',
  'personalfinanceindia',
  'IndiaBusinessOpportunity',
];

function buildSubredditList(dealers) {
  const seen = new Set();
  const list = [];

  function add(sub) {
    const clean = sub.trim().replace(/^r\//, '');
    if (clean && !seen.has(clean)) { seen.add(clean); list.push(clean); }
  }

  for (const dealer of dealers) {
    const citySubs = CITY_SUBREDDIT_MAP[dealer.city] || [];
    if (citySubs.length) {
      citySubs.forEach(add);
    } else {
      (STATE_SUBREDDIT_MAP[dealer.state] || []).forEach(add);
    }
    if (dealer.custom_subreddits) {
      dealer.custom_subreddits.split(',').forEach(add);
    }
  }

  INDIA_FALLBACK_SUBREDDITS.forEach(add);
  return list;
}

module.exports = { buildSubredditList, CITY_SUBREDDIT_MAP, STATE_SUBREDDIT_MAP, INDIA_FALLBACK_SUBREDDITS };
