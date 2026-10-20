import { useMemo } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Layers, Star } from "lucide-react";

interface Ranking {
  position: number;
  item: string;
  rankingGroup?: string;
  isClientBrand?: boolean;
}

interface ModelRankings {
  modelName: string;
  modelId?: string;
  rankings: Ranking[];
}

interface AliasObject {
  value?: string;
}

interface RankingsAccordionProps {
  modelRankings: ModelRankings[];
  clientName?: string;
  clientAliases?: (string | AliasObject)[];
}

interface ProcessedModelData {
  modelName: string;
  modelId?: string;
  totalGroups: number;
  groupsWithClient: number;
  groups: {
    name: string;
    hasClient: boolean;
    items: {
      position: number;
      item: string;
      isClientBrand: boolean;
    }[];
  }[];
}

function normalizeAliases(aliases?: (string | AliasObject)[]): string[] {
  if (!aliases) return [];
  return aliases
    .map((a) => {
      if (typeof a === "string") return a;
      if (a && typeof a === "object" && a.value) return a.value;
      return null;
    })
    .filter((a): a is string => a !== null && a.length > 0);
}

function processModelRankings(
  model: ModelRankings,
  clientName?: string,
  clientAliases?: (string | AliasObject)[]
): ProcessedModelData {
  const validRankings = model.rankings.filter(
    (r) => r && r.item && typeof r.item === "string"
  );

  const groupedRankings = validRankings.reduce(
    (acc: Record<string, Ranking[]>, ranking) => {
      const group = ranking.rankingGroup || "General";
      if (!acc[group]) {
        acc[group] = [];
      }
      acc[group].push(ranking);
      return acc;
    },
    {}
  );

  const normalizedAliases = normalizeAliases(clientAliases);
  const allTerms = clientName
    ? [clientName.toLowerCase(), ...normalizedAliases.map((a) => a.toLowerCase())]
    : [];

  const groups = Object.entries(groupedRankings)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([groupName, rankings]) => {
      const sortedItems = rankings
        .sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
        .map((ranking) => {
          const itemLower = (ranking.item || "").toLowerCase();
          const isClientBrand =
            ranking.isClientBrand ||
            (itemLower.length > 0 &&
              allTerms.some(
                (term) => itemLower.includes(term) || term.includes(itemLower)
              ));
          return {
            position: ranking.position ?? 0,
            item: ranking.item || "Unknown",
            isClientBrand,
          };
        });

      const hasClient = sortedItems.some((item) => item.isClientBrand);

      return {
        name: groupName,
        hasClient,
        items: sortedItems,
      };
    });

  return {
    modelName: model.modelName,
    modelId: model.modelId,
    totalGroups: groups.length,
    groupsWithClient: groups.filter((g) => g.hasClient).length,
    groups,
  };
}

export function RankingsAccordion({
  modelRankings,
  clientName,
  clientAliases,
}: RankingsAccordionProps) {
  const processedData = useMemo(() => {
    return modelRankings
      .filter((m) => m.rankings && m.rankings.length > 0)
      .map((model) => processModelRankings(model, clientName, clientAliases));
  }, [modelRankings, clientName, clientAliases]);

  if (processedData.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4">
        No rankings available
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <Layers className="h-4 w-4 text-muted-foreground" />
        <h4 className="text-sm font-semibold">RANKINGS</h4>
      </div>

      <Accordion type="multiple" className="space-y-2">
        {processedData.map((model, modelIndex) => (
          <AccordionItem
            key={model.modelId || modelIndex}
            value={`model-${modelIndex}`}
            className="border rounded-lg bg-muted/30"
            data-testid={`rankings-accordion-model-${modelIndex}`}
          >
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <div className="flex items-center justify-between w-full pr-2">
                <span className="font-medium text-sm">{model.modelName}</span>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="secondary"
                    className="text-xs"
                    data-testid={`badge-groups-count-${modelIndex}`}
                  >
                    {model.totalGroups} Group{model.totalGroups !== 1 ? "s" : ""}
                  </Badge>
                  {model.groupsWithClient > 0 && (
                    <Badge
                      className="text-xs bg-[#EDE8FF] text-[#3D1A66] hover:bg-[#DED4FF]"
                      data-testid={`badge-client-groups-${modelIndex}`}
                    >
                      <Star className="h-3 w-3 mr-1" />
                      {model.groupsWithClient} with {clientName || "Client"}
                    </Badge>
                  )}
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4">
              <div className="space-y-4 pt-2">
                {model.groups.map((group, groupIndex) => (
                  <div
                    key={groupIndex}
                    className="space-y-1.5"
                    data-testid={`ranking-group-${modelIndex}-${groupIndex}`}
                  >
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-foreground">
                        {group.name}
                      </p>
                      {group.hasClient && (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 border-[#EDE8FF] text-[#3D1A66]"
                        >
                          Client Listed
                        </Badge>
                      )}
                    </div>
                    <div className="space-y-1 pl-2">
                      {group.items.map((item, itemIndex) => (
                        <div
                          key={itemIndex}
                          className={`flex items-center gap-2 text-xs ${
                            item.isClientBrand
                              ? "bg-[#EDE8FF]/50 -mx-2 px-2 py-1 rounded"
                              : ""
                          }`}
                          data-testid={`ranking-item-${modelIndex}-${groupIndex}-${itemIndex}`}
                        >
                          <Badge
                            variant="outline"
                            className="w-6 justify-center text-xs shrink-0"
                          >
                            {item.position}
                          </Badge>
                          <span
                            className={
                              item.isClientBrand
                                ? "font-semibold text-[#3D1A66]"
                                : ""
                            }
                          >
                            {item.item}
                          </span>
                          {item.isClientBrand && (
                            <Badge
                              className="text-[10px] px-1.5 py-0 bg-[#EDE8FF] text-[#3D1A66] hover:bg-[#DED4FF]"
                            >
                              YOU
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
