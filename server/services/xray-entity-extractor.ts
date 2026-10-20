export interface ExtractedEntities {
  companies: string[];
  products: string[];
  locations: string[];
  people: string[];
  technologies: string[];
}

/**
 * Common company suffixes and indicators
 */
const COMPANY_PATTERNS = [
  /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:Inc|LLC|Ltd|Corp|Corporation|Company|Co|Group|Holdings|Partners|Ventures)\b/g,
  /\b([A-Z][A-Z]+)\s+(?:Inc|LLC|Ltd|Corp)\b/g, // Acronyms like IBM Corp
];

/**
 * Technology and framework patterns
 */
const TECH_PATTERNS = [
  /\b(React|Vue|Angular|Node\.?js|Python|Java|JavaScript|TypeScript|PHP|Ruby|Swift|Kotlin|Go|Rust)\b/gi,
  /\b(AWS|Azure|Google Cloud|GCP|Docker|Kubernetes|PostgreSQL|MySQL|MongoDB|Redis)\b/gi,
  /\b(API|REST|GraphQL|WebSocket|OAuth|JWT|SSL|TLS|HTTPS)\b/gi,
];

/**
 * Common location patterns
 */
const LOCATION_PATTERNS = [
  /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z]{2})\b/g, // City, STATE
  /\b(New York|Los Angeles|San Francisco|Chicago|Boston|Seattle|Portland|Austin|Miami|Denver|London|Paris|Tokyo|Berlin|Sydney)\b/gi,
  /\b(USA|United States|UK|United Kingdom|Canada|Germany|France|Japan|China|India|Australia)\b/gi,
];

/**
 * People name patterns (very basic)
 */
const PEOPLE_PATTERNS = [
  /(?:CEO|CTO|CFO|founder|co-founder|president|director)\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/gi,
  /\b([A-Z][a-z]+\s+[A-Z][a-z]+)\s+(?:founded|created|built|launched|started)/gi,
  /(?:by|with|from)\s+([A-Z][a-z]+\s+[A-Z][a-z]+)(?:\s+and\s+([A-Z][a-z]+\s+[A-Z][a-z]+))?/g,
];

/**
 * Extract entities from text using pattern matching
 */
export function extractEntities(text: string, clientName?: string): ExtractedEntities {
  const entities: ExtractedEntities = {
    companies: [],
    products: [],
    locations: [],
    people: [],
    technologies: []
  };

  if (!text || text.length === 0) {
    return entities;
  }

  // Extract companies
  const companySet = new Set<string>();
  for (const pattern of COMPANY_PATTERNS) {
    const matches = Array.from(text.matchAll(pattern));
    for (const match of matches) {
      const company = match[1]?.trim();
      if (company && company.length > 2 && company.length < 100) {
        companySet.add(company);
      }
    }
  }

  // Extract common brand names (capitalized words that appear multiple times)
  const capitalizedWords = text.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,2}\b/g) || [];
  const wordFrequency = new Map<string, number>();
  
  for (const word of capitalizedWords) {
    if (word.length > 3 && word.length < 50) {
      wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
    }
  }

  // Add frequently mentioned capitalized phrases as potential companies
  for (const [word, count] of Array.from(wordFrequency.entries())) {
    if (count >= 2 && !isCommonWord(word)) {
      companySet.add(word);
    }
  }

  entities.companies = Array.from(companySet).slice(0, 50);

  // Extract technologies
  const techSet = new Set<string>();
  for (const pattern of TECH_PATTERNS) {
    const matches = Array.from(text.matchAll(pattern));
    for (const match of matches) {
      const tech = match[0]?.trim();
      if (tech) {
        techSet.add(tech);
      }
    }
  }
  entities.technologies = Array.from(techSet).slice(0, 30);

  // Extract locations
  const locationSet = new Set<string>();
  for (const pattern of LOCATION_PATTERNS) {
    const matches = Array.from(text.matchAll(pattern));
    for (const match of matches) {
      if (match[1]) {
        locationSet.add(match[1].trim());
      }
      if (match[2]) {
        locationSet.add(match[2].trim());
      }
    }
  }
  entities.locations = Array.from(locationSet).slice(0, 30);

  // Extract people
  const peopleSet = new Set<string>();
  for (const pattern of PEOPLE_PATTERNS) {
    const matches = Array.from(text.matchAll(pattern));
    for (const match of matches) {
      const person = match[1]?.trim();
      if (person && person.length > 5 && person.length < 50 && !isCommonPhrase(person)) {
        peopleSet.add(person);
      }
      // Check for second person in "X and Y" pattern
      if (match[2]) {
        const person2 = match[2].trim();
        if (person2.length > 5 && person2.length < 50) {
          peopleSet.add(person2);
        }
      }
    }
  }
  entities.people = Array.from(peopleSet).slice(0, 20);

  // Extract products (words near product indicators)
  const productSet = new Set<string>();
  const productIndicators = /\b(?:product|solution|service|platform|app|software|tool|system|device)\b/gi;
  const sentences = text.split(/[.!?]+/);
  
  for (const sentence of sentences) {
    if (productIndicators.test(sentence)) {
      // Look for capitalized product names in product-related sentences
      const productMatches = sentence.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) || [];
      for (const product of productMatches) {
        if (product.length > 3 && product.length < 50 && !isCommonWord(product)) {
          productSet.add(product);
        }
      }
    }
  }

  // If client name is known, ensure it's included in companies
  if (clientName && !entities.companies.includes(clientName)) {
    entities.companies.unshift(clientName);
  }

  entities.products = Array.from(productSet).slice(0, 40);

  return entities;
}

/**
 * Check if a word is a common non-entity word
 */
function isCommonWord(word: string): boolean {
  const common = [
    'The', 'This', 'That', 'These', 'Those', 'What', 'Where', 'When', 'Why', 'How',
    'About', 'More', 'Learn', 'Read', 'Get', 'See', 'View', 'Our', 'Your',
    'Here', 'There', 'Welcome', 'Home', 'Page', 'Site', 'Website', 'Blog',
    'Contact', 'Privacy', 'Terms', 'Policy', 'All', 'Rights', 'Reserved'
  ];
  return common.includes(word);
}

/**
 * Check if a phrase is a common non-person phrase
 */
function isCommonPhrase(phrase: string): boolean {
  const common = [
    'United States', 'New York', 'Los Angeles', 'San Francisco',
    'Learn More', 'Get Started', 'Sign Up', 'Read More', 'Contact Us'
  ];
  return common.includes(phrase);
}

/**
 * Merge entities from multiple sources
 */
export function mergeEntities(...entitySets: ExtractedEntities[]): ExtractedEntities {
  const merged: ExtractedEntities = {
    companies: [],
    products: [],
    locations: [],
    people: [],
    technologies: []
  };

  for (const entities of entitySets) {
    merged.companies.push(...entities.companies);
    merged.products.push(...entities.products);
    merged.locations.push(...entities.locations);
    merged.people.push(...entities.people);
    merged.technologies.push(...entities.technologies);
  }

  // Deduplicate
  merged.companies = Array.from(new Set(merged.companies));
  merged.products = Array.from(new Set(merged.products));
  merged.locations = Array.from(new Set(merged.locations));
  merged.people = Array.from(new Set(merged.people));
  merged.technologies = Array.from(new Set(merged.technologies));

  return merged;
}
