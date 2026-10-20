export interface DashboardStats {
  totalPrompts: number;
  avgVisibilityScore: number;
  totalCitations: number;
  activeModels: number;
  recentRuns: any[];
  totalRuns: number;
  completedRuns: number;
}

export interface TopTopic {
  label: string;
  score: number;
}

export const mockDashboardStats: DashboardStats = {
  totalPrompts: 1247,
  avgVisibilityScore: 73.2,
  totalCitations: 486,
  activeModels: 4,
  recentRuns: [],
  totalRuns: 23,
  completedRuns: 18
};

export const mockTopTopics: TopTopic[] = [
  { label: "AI & Machine Learning", score: 87.2 },
  { label: "Cloud Computing", score: 74.5 },
  { label: "Enterprise Software", score: 68.1 },
  { label: "Data Analytics", score: 61.7 }
];

export const mockRecentRuns = [
  {
    id: "1",
    name: "Q4 Market Analysis",
    description: "Technology sector focus",
    status: "done",
    prompts: 147,
    models: 4,
    score: 73.2,
    createdAt: "2 hours ago"
  },
  {
    id: "2", 
    name: "Competitor Benchmark",
    description: "vs TechCorp analysis",
    status: "running",
    prompts: 89,
    models: 3,
    score: null,
    createdAt: "12 min ago"
  },
  {
    id: "3",
    name: "Brand Mention Study", 
    description: "Comprehensive brand analysis",
    status: "done",
    prompts: 203,
    models: 2,
    score: 68.7,
    createdAt: "1 day ago"
  }
];
