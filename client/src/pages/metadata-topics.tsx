import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Edit } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useErrorToast } from "@/hooks/use-error-toast";
import type { Topic } from "@shared/schema";
import { useSelectedClientId, useUrlClientId } from "@/hooks/use-selected-client-id";
import { ActiveOperationsBanner } from "@/components/activity/active-operations-banner";

const CATEGORIES = [
  "Product Features",
  "Use Cases",
  "Industry Applications",
  "Technical Capabilities",
  "Competitors",
  "Market Position",
  "Customer Benefits",
  "Innovation",
  "Other",
];

const SOURCE_DISPLAY_NAMES: Record<string, string> = {
  ai: "Smart Suggestion",
  crawl: "Auto-Extracted",
  manual: "Manual",
  csv: "CSV Import",
};

export default function MetadataTopics() {
  const { toast } = useToast();
  const errorToast = useErrorToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingTopic, setEditingTopic] = useState<Topic | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");

  const urlClientId = useUrlClientId();
  const storedClientId = useSelectedClientId();
  const selectedClientId = urlClientId || storedClientId;

  const { data: topics = [], isLoading } = useQuery<Topic[]>({
    queryKey: ["/api/v1/topics", selectedClientId],
    enabled: !!selectedClientId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { label: string; category: string }) => {
      return apiRequest("POST", "/api/v1/topics", {
        clientId: selectedClientId,
        label: data.label,
        category: data.category,
        source: "manual",
        accepted: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/v1/topics", selectedClientId],
      });
      toast({ title: "Topic added successfully" });
      setIsAddDialogOpen(false);
      setNewLabel("");
      setNewCategory("");
    },
    onError: (error: unknown) => {
      errorToast("Couldn't add topic", error);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: {
      id: string;
      label: string;
      category: string;
    }) => {
      return apiRequest("PUT", `/api/v1/topics/${data.id}`, {
        label: data.label,
        category: data.category,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/v1/topics", selectedClientId],
      });
      toast({ title: "Topic updated successfully" });
      setEditingTopic(null);
      setNewLabel("");
      setNewCategory("");
    },
    onError: (error: unknown) => {
      errorToast("Couldn't update topic", error);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/v1/topics/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/v1/topics", selectedClientId],
      });
      toast({ title: "Topic deleted successfully" });
    },
    onError: (error: unknown) => {
      errorToast("Couldn't delete topic", error);
    },
  });

  const handleAdd = () => {
    if (!newLabel || !newCategory) {
      toast({ title: "Please fill all fields", variant: "destructive" });
      return;
    }
    createMutation.mutate({ label: newLabel, category: newCategory });
  };

  const handleUpdate = () => {
    if (!editingTopic || !newLabel || !newCategory) {
      toast({ title: "Please fill all fields", variant: "destructive" });
      return;
    }
    updateMutation.mutate({
      id: editingTopic.id,
      label: newLabel,
      category: newCategory,
    });
  };

  const openEditDialog = (topic: Topic) => {
    setEditingTopic(topic);
    setNewLabel(topic.label);
    setNewCategory(topic.category || "");
  };

  const filteredTopics = topics.filter((topic) => {
    const matchesSearch = topic.label
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesCategory =
      filterCategory === "all" || topic.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const topicsByCategory = filteredTopics.reduce(
    (acc, topic) => {
      const category = topic.category || "Uncategorized";
      if (!acc[category]) acc[category] = [];
      acc[category].push(topic);
      return acc;
    },
    {} as Record<string, Topic[]>,
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-muted-foreground">Loading topics...</div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <ActiveOperationsBanner clientId={selectedClientId} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Topics & Keywords</h1>
          <p className="text-muted-foreground mt-1">
            Complete list of topics and keywords generated from site crawl
          </p>
        </div>
        <Button
          onClick={() => setIsAddDialogOpen(true)}
          data-testid="button-add-topic"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Topic
        </Button>
      </div>

      <div className="flex gap-4">
        <Input
          placeholder="Search topics..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="max-w-sm"
          data-testid="input-search-topics"
        />
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger
            className="w-[200px]"
            data-testid="select-filter-category"
          >
            <SelectValue placeholder="Filter by category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {cat}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-8">
        {Object.entries(topicsByCategory).map(([category, categoryTopics]) => (
          <div key={category} className="space-y-3">
            <h3 className="text-lg font-semibold text-[#3D1A66] dark:text-[#EDE8FF]">{category}</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Topic/Keyword</TableHead>
                  <TableHead className="w-40">Source</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categoryTopics.map((topic) => (
                  <TableRow key={topic.id}>
                    <TableCell
                      className="font-medium"
                      data-testid={`text-topic-${topic.id}`}
                    >
                      {topic.label}
                    </TableCell>
                    <TableCell className="w-40 text-muted-foreground whitespace-nowrap">
                      {SOURCE_DISPLAY_NAMES[topic.source] || topic.source}
                    </TableCell>
                    <TableCell className="w-32 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(topic)}
                          data-testid={`button-edit-${topic.id}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMutation.mutate(topic.id)}
                          data-testid={`button-delete-${topic.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}
        {Object.keys(topicsByCategory).length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            No topics found. Add your first topic to get started.
          </div>
        )}
      </div>

      <Dialog
        open={isAddDialogOpen || !!editingTopic}
        onOpenChange={(open) => {
          if (!open) {
            setIsAddDialogOpen(false);
            setEditingTopic(null);
            setNewLabel("");
            setNewCategory("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingTopic ? "Edit Topic" : "Add New Topic"}
            </DialogTitle>
            <DialogDescription>
              {editingTopic
                ? "Update the topic details below"
                : "Add a new topic or keyword to the list"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Topic/Keyword</label>
              <Input
                placeholder="Enter topic or keyword"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                data-testid="input-topic-label"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Category</label>
              <Select value={newCategory} onValueChange={setNewCategory}>
                <SelectTrigger data-testid="select-topic-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={editingTopic ? handleUpdate : handleAdd}
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-topic"
            >
              {editingTopic ? "Update" : "Add"} Topic
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
