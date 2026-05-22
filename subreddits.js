// City → subreddit(s). Keys must match the city value stored in the dealers table.
const CITY_SUBREDDIT_MAP = {
  // NCR — all NCR cities also get DelhiNCR
  'Delhi':       ['delhi', 'DelhiNCR'],
  'New Delhi':   ['delhi', 'DelhiNCR'],
  'Noida':       ['noida', 'DelhiNCR'],
  'Greater Noida': ['noida', 'DelhiNCR'],
  'Gurugram':    ['gurgaon', 'DelhiNCR'],
  'Gurgaon':     ['gurgaon', 'DelhiNCR'],
  'Faridabad':   ['Faridabad', 'DelhiNCR'],
  'Ghaziabad':   ['Ghaziabad', 'DelhiNCR'],

  // Maharashtra
  'Mumbai':      ['mumbai'],
  'Navi Mumbai': ['mumbai', 'NaviMumbai'],
  'Thane':       ['mumbai', 'thane'],
  'Pune':        ['pune'],
  'Nagpur':      ['nagpur'],
  'Nashik':      ['nashik'],
  'Aurangabad':  ['aurangabad'],

  // Karnataka
  'Bengaluru':   ['bangalore'],
  'Bangalore':   ['bangalore'],
  'Mysuru':      ['mysore'],
  'Mysore':      ['mysore'],
  'Mangaluru':   ['mangalore'],
  'Mangalore':   ['mangalore'],
  'Hubballi':    ['hubli'],
  'Hubli':       ['hubli'],

  // Telangana / Andhra
  'Hyderabad':        ['hyderabad'],
  'Secunderabad':     ['hyderabad'],
  'Vijayawada':       ['Vijayawada'],
  'Visakhapatnam':    ['vizag'],
  'Vizag':            ['vizag'],

  // Tamil Nadu
  'Chennai':          ['Chennai'],
  'Coimbatore':       ['Coimbatore'],
  'Madurai':          ['madurai'],
  'Tiruchirappalli':  ['trichy'],
  'Trichy':           ['trichy'],
  'Salem':            ['tamilnadu'],
  'Vellore':          ['tamilnadu'],
  'Pondicherry':      ['pondicherry'],

  // West Bengal
  'Kolkata':     ['kolkata'],

  // Gujarat
  'Ahmedabad':   ['ahmedabad'],
  'Surat':       ['surat'],
  'Vadodara':    ['vadodara'],
  'Rajkot':      ['rajkot'],

  // Rajasthan
  'Jaipur':      ['jaipur'],
  'Jodhpur':     ['jodhpur'],
  'Udaipur':     ['udaipur'],
  'Kota':        ['rajasthan'],

  // Uttar Pradesh
  'Lucknow':     ['lucknow'],
  'Kanpur':      ['kanpur'],
  'Agra':        ['agra'],
  'Varanasi':    ['varanasi'],
  'Prayagraj':   ['prayagraj'],
  'Allahabad':   ['prayagraj'],
  'Meerut':      ['meerut'],

  // Punjab / Haryana / Himachal
  'Chandigarh':  ['chandigarh'],
  'Amritsar':    ['amritsar'],
  'Ludhiana':    ['ludhiana'],
  'Jalandhar':   ['jalandhar'],
  'Patiala':     ['chandigarh'],
  'Ambala':      ['chandigarh'],

  // Madhya Pradesh
  'Bhopal':      ['bhopal'],
  'Indore':      ['indore'],
  'Jabalpur':    ['jabalpur'],

  // Kerala
  'Kochi':               ['kochi', 'Kerala'],
  'Cochin':              ['kochi', 'Kerala'],
  'Thiruvananthapuram':  ['Kerala'],
  'Trivandrum':          ['Kerala'],
  'Kozhikode':           ['Kerala'],
  'Thrissur':            ['Kerala'],

  // Odisha
  'Bhubaneswar': ['bhubaneswar'],

  // Bihar / Jharkhand
  'Patna':       ['patna'],
  'Ranchi':      ['ranchi'],

  // Assam / Northeast
  'Guwahati':    ['guwahati'],

  // Chhattisgarh
  'Raipur':      ['raipur'],

  // Uttarakhand
  'Dehradun':    ['Dehradun'],

  // Jammu & Kashmir
  'Jammu':       ['jammukashmir'],
  'Srinagar':    ['jammukashmir'],

  // Himachal
  'Shimla':      ['himachal'],
  'Manali':      ['himachal'],

  // Goa
  'Panaji':      ['goa'],
  'Goa':         ['goa'],

  // Chhattisgarh / Other
  'Bhilai':      ['raipur'],
};

const STATE_SUBREDDIT_MAP = {
  'Haryana':          ['haryana', 'DelhiNCR'],
  'Delhi (NCT)':      ['delhi', 'DelhiNCR'],
  'Uttar Pradesh':    ['lucknow'],
  'Maharashtra':      ['mumbai'],
  'Karnataka':        ['bangalore'],
  'Tamil Nadu':       ['Chennai'],
  'Telangana':        ['hyderabad'],
  'Andhra Pradesh':   ['andhra'],
  'West Bengal':      ['kolkata'],
  'Kerala':           ['Kerala'],
  'Madhya Pradesh':   ['bhopal'],
  'Gujarat':          ['ahmedabad'],
  'Rajasthan':        ['jaipur'],
  'Punjab':           ['chandigarh'],
  'Bihar':            ['bihar'],
  'Odisha':           ['bhubaneswar'],
  'Jharkhand':        ['jharkhand'],
  'Chhattisgarh':     ['chhattisgarh'],
  'Assam':            ['assam'],
  'Himachal Pradesh': ['himachal'],
  'Uttarakhand':      ['uttarakhand'],
  'Jammu and Kashmir':['jammukashmir'],
  'Goa':              ['goa'],
  'Chandigarh':       ['chandigarh'],
  'Tripura':          ['india'],
  'Meghalaya':        ['india'],
  'Manipur':          ['india'],
  'Nagaland':         ['india'],
  'Arunachal Pradesh':['india'],
  'Mizoram':          ['india'],
  'Sikkim':           ['india'],
};

// Category-specific subreddits — added for any dealer whose industry_category matches
const CATEGORY_SUBREDDIT_MAP = {
  'Automotive':               ['CarsIndia', 'IndiaBikes'],
  'Real Estate':              ['realestateindia', 'IndianRealEstate'],
  'Finance & Insurance':      ['IndiaInvestments', 'personalfinanceindia'],
  'IT Services & Software':   ['developersIndia', 'cscareerquestions'],
  'Electronics & Gadgets':    ['IndianGaming', 'GadgetsIndia'],
  'Education & Coaching':     ['Indian_Academia', 'BITSPilani'],
  'Healthcare & Wellness':    ['india'],
  'Legal Services':           ['LegalAdviceIndia'],
  'Furniture & Home Decor':   ['india'],
  'Fitness & Gym':            ['india'],
  'Food & Catering':          ['india', 'FoodIndia'],
  'Construction & Interior Design': ['india'],
  'Clothing & Fashion':       ['india'],
  'Beauty & Salon':           ['india'],
  'Marketing & Advertising':  ['Entrepreneur_india'],
  'Photography & Events':     ['india'],
  'Logistics & Packers Movers': ['india'],
  'HR & Staffing':            ['india', 'Entrepreneur_india'],
  'Retail & E-commerce':      ['india', 'Entrepreneur_india'],
  'Travel & Tourism':         ['india', 'IndiaTourism'],
  'Other':                    ['india'],
};

// Subreddits where people explicitly post "looking for / WTB / need a..."
const BUY_LEAD_SUBREDDITS = [
  'IndianBuySell',
  'AskIndia',
];

// General India fallbacks shown for every crawl
const INDIA_FALLBACK_SUBREDDITS = [
  'india',
  'Entrepreneur_india',
  'IndiaInvestments',
  'personalfinanceindia',
  'IndianBuySell',
  'AskIndia',
];

function buildSubredditList(dealers) {
  const seen = new Set();
  const list = [];

  function add(sub) {
    const clean = sub.trim().replace(/^r\//, '');
    if (clean && !seen.has(clean)) { seen.add(clean); list.push(clean); }
  }

  for (const dealer of dealers) {
    // City-specific subreddits
    const citySubs = CITY_SUBREDDIT_MAP[dealer.city];
    if (citySubs && citySubs.length) {
      citySubs.forEach(add);
    } else {
      (STATE_SUBREDDIT_MAP[dealer.state] || []).forEach(add);
    }

    // Category-specific subreddits
    const catSubs = CATEGORY_SUBREDDIT_MAP[dealer.industry_category] || [];
    catSubs.forEach(add);

    // Custom subreddits the dealer added themselves
    if (dealer.custom_subreddits) {
      dealer.custom_subreddits.split(',').forEach(add);
    }
  }

  // Always-on subreddits
  BUY_LEAD_SUBREDDITS.forEach(add);
  INDIA_FALLBACK_SUBREDDITS.forEach(add);

  return list;
}

module.exports = {
  buildSubredditList,
  CITY_SUBREDDIT_MAP,
  STATE_SUBREDDIT_MAP,
  CATEGORY_SUBREDDIT_MAP,
  INDIA_FALLBACK_SUBREDDITS,
  BUY_LEAD_SUBREDDITS,
};
