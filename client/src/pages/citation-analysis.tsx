import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, ChevronRight } from "lucide-react";
import { OpportunityRunFilter } from "@/components/OpportunityRunFilter";
import { useSelectedClientId, useUrlClientId } from "@/hooks/use-selected-client-id";

interface CitationSource {
  rank: number;
  domain: string;
  fullDomains?: string[];
  representativeUrl: string;
  urlCount: number;
  frequency: number;
  usagePercentage: number;
}

interface CitationURL {
  url: string;
  frequency: number;
}

export default function CitationAnalysis() {
  const urlClientId = useUrlClientId();
  const storedClientId = useSelectedClientId();
  const selectedClientId = urlClientId || storedClientId;
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Get client data to identify client domains
  const { data: client } = useQuery({
    queryKey: ['/api/v1/clients', selectedClientId],
    enabled: !!selectedClientId,
    queryFn: async () => {
      const response = await fetch(`/api/v1/clients/${selectedClientId}`);
      if (!response.ok) throw new Error('Failed to fetch client');
      return response.json();
    },
  });

  const { data: citations = [], isLoading } = useQuery<CitationSource[]>({
    queryKey: ['/api/v1/opportunities/citations', selectedClientId, selectedRunId],
    enabled: !!selectedClientId,
    queryFn: async () => {
      const url = new URL('/api/v1/opportunities/citations', window.location.origin);
      if (selectedRunId) url.searchParams.set('promptRunId', selectedRunId);
      const response = await fetch(url.toString(), {
        headers: selectedClientId ? { 'X-Client-Id': selectedClientId } : {}
      });
      if (!response.ok) throw new Error('Failed to fetch citations');
      return response.json();
    },
  });

  // Helper to check if a domain (brand or full) belongs to the client
  const isClientDomain = (citation: CitationSource): boolean => {
    if (!client) return false;
    
    const clientDomains: string[] = [];
    
    // Extract domain from client website
    if (client.website) {
      try {
        const url = new URL(client.website.startsWith('http') ? client.website : `https://${client.website}`);
        const hostname = url.hostname.replace(/^www\./, '');
        clientDomains.push(hostname);
      } catch {}
    }
    
    // Extract domains from client URLs array
    if (client.urls && Array.isArray(client.urls)) {
      for (const urlObj of client.urls) {
        if (urlObj.url) {
          try {
            const url = new URL(urlObj.url.startsWith('http') ? urlObj.url : `https://${urlObj.url}`);
            const hostname = url.hostname.replace(/^www\./, '');
            clientDomains.push(hostname);
          } catch {}
        }
      }
    }
    
    // Check brand domain and all full domains
    const domainsToCheck = [citation.domain, ...(citation.fullDomains || [])];
    
    return domainsToCheck.some(citationDomain => 
      clientDomains.some(clientDomain => {
        return citationDomain === clientDomain || 
               citationDomain.endsWith(`.${clientDomain}`) || 
               clientDomain.endsWith(`.${citationDomain}`);
      })
    );
  };

  // Query for domain URLs (drill-down)
  const { data: domainUrls = [] } = useQuery<CitationURL[]>({
    queryKey: ['/api/v1/opportunities/citations/domain', expandedDomain, selectedClientId, selectedRunId],
    enabled: !!expandedDomain && !!selectedClientId,
    queryFn: async () => {
      if (!expandedDomain) return [];
      const url = new URL(`/api/v1/opportunities/citations/domain/${encodeURIComponent(expandedDomain)}`, window.location.origin);
      if (selectedRunId) url.searchParams.set('promptRunId', selectedRunId);
      const response = await fetch(url.toString(), {
        headers: selectedClientId ? { 'X-Client-Id': selectedClientId } : {}
      });
      if (!response.ok) throw new Error('Failed to fetch domain URLs');
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-muted-foreground">Loading citation analysis...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-foreground">Citation Analysis</h1>
          <p className="text-gray-600 dark:text-muted-foreground mt-1">
            Top 20 domains cited by AI models, grouped by root domain with drill-down capabilities
          </p>
          <p className="text-xs text-muted-foreground mt-2 border-l-2 border-muted pl-3">
            <span className="font-medium">Citations:</span> Total times this domain appeared across all AI responses. <span className="font-medium">Usage %:</span> Percentage of responses that cited this domain.
          </p>
        </div>
        <OpportunityRunFilter
          selectedClientId={selectedClientId}
          selectedRunId={selectedRunId}
          onRunChange={setSelectedRunId}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ExternalLink className="h-5 w-5" />
            Top Citation Domains
          </CardTitle>
        </CardHeader>
        <CardContent>
          {citations.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No citation data available. Run prompts to generate citation analysis.
            </div>
          ) : (
            <Accordion 
              type="single" 
              collapsible 
              value={expandedDomain || undefined}
              onValueChange={(value) => setExpandedDomain(value || null)}
            >
              {citations.map((citation) => (
                <AccordionItem 
                  key={citation.domain} 
                  value={citation.domain}
                  data-testid={`citation-accordion-${citation.rank}`}
                >
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center justify-between w-full pr-4">
                      {/* Left: Rank & Domain */}
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        <Badge 
                          variant={citation.rank <= 3 ? "default" : "secondary"}
                          className="shrink-0"
                        >
                          #{citation.rank}
                        </Badge>
                        <div className="flex flex-col items-start min-w-0">
                          <div className="font-medium text-gray-900 dark:text-foreground flex items-center gap-2">
                            {citation.domain}
                            {isClientDomain(citation) && (
                              <Badge variant="default" className="text-xs bg-[#EDE8FF] text-[#3D1A66] hover:bg-[#EDE8FF] font-bold">
                                You
                              </Badge>
                            )}
                            {citation.urlCount > 1 && (
                              <Badge variant="outline" className="text-xs">
                                {citation.urlCount} URLs
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-gray-600 dark:text-muted-foreground truncate max-w-md">
                            {citation.representativeUrl}
                          </div>
                        </div>
                      </div>

                      {/* Right: Stats */}
                      <div className="flex items-center gap-6 shrink-0">
                        <div className="text-center">
                          <div className="text-sm font-semibold text-gray-900 dark:text-foreground">
                            {citation.frequency}
                          </div>
                          <div className="text-xs text-gray-600 dark:text-muted-foreground">
                            Citations
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-sm font-semibold text-gray-900 dark:text-foreground">
                            {citation.usagePercentage}%
                          </div>
                          <div className="text-xs text-gray-600 dark:text-muted-foreground">
                            Usage %
                          </div>
                        </div>
                      </div>
                    </div>
                  </AccordionTrigger>

                  <AccordionContent>
                    {expandedDomain === citation.domain && domainUrls.length > 0 ? (
                      <div className="pt-4 pb-2 px-4 space-y-3 bg-muted/30 rounded-md">
                        <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                          Individual URLs for {citation.domain}:
                        </div>
                        {domainUrls.map((urlData, idx) => (
                          <div 
                            key={urlData.url} 
                            className="flex items-center justify-between p-3 bg-background rounded border"
                            data-testid={`url-detail-${idx}`}
                          >
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                              <div className="min-w-0 flex-1">
                                <a 
                                  href={urlData.url} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-sm text-[#3D1A66] dark:text-[#EDE8FF] hover:underline flex items-center gap-1 break-all"
                                  data-testid={`link-url-${idx}`}
                                >
                                  {urlData.url}
                                  <ExternalLink className="h-3 w-3 shrink-0" />
                                </a>
                              </div>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 ml-4">
                              <div className="text-sm text-center">
                                <span className="font-semibold text-gray-900 dark:text-foreground">
                                  {urlData.frequency}
                                </span>
                                <span className="text-xs text-gray-600 dark:text-muted-foreground ml-1">
                                  citations
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : expandedDomain === citation.domain ? (
                      <div className="py-4 text-center text-sm text-muted-foreground">
                        Loading URL details...
                      </div>
                    ) : null}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
