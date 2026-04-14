import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Link } from 'react-router';
import { motion, AnimatePresence, useInView } from "framer-motion";
import Navbar from "@/components/Navbar";
import AnimatedBlocksBanner from "@/components/AnimatedBlocksBanner";
import {
  Search,
  ExternalLink,
  Users,
  AlertCircle,
  Loader2,
  X,
  Calendar,
  Plus,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiSelect } from "@/components/ui/multi-select";
import { NotionRenderer } from "@/components/NotionRenderer";

interface Project {
  id: string;
  name: string;
  description: string;
  term: string;
  sector?: string;
  sectors?: string[];
  tags: string[];
  teamMembers: string[];
  coverImage?: string;
  product?: string[];
  techStack?: string[];
  projectUrls: { url: string; label?: string }[];
}

interface ProjectsResponse {
  projects: Project[];
}

const MOCK_PROJECTS: Project[] = [
  {
    id: "1",
    name: "DALI Lab Website",
    description: "The official DALI Lab website showcasing projects, team members, and educational offerings.",
    term: "24F",
    sectors: ["Web"],
    tags: ["React", "TypeScript", "Tailwind"],
    teamMembers: ["Tim Tregubov", "Sophie Park"],
    coverImage: "https://placehold.co/800x450?text=DALI+Website",
    product: ["Web App"],
    techStack: ["React", "TypeScript", "Tailwind CSS"],
    projectUrls: [{ url: "#", label: "View Project" }],
  },
  {
    id: "2",
    name: "StudyBuddy",
    description: "An AI-powered study companion that helps students organize notes and prepare for exams.",
    term: "24W",
    sectors: ["Education"],
    tags: ["AI", "React Native", "Python"],
    teamMembers: ["Alex Chen", "Jordan Lee"],
    coverImage: "https://placehold.co/800x450?text=StudyBuddy",
    product: ["Mobile App"],
    techStack: ["React Native", "Python", "OpenAI"],
    projectUrls: [{ url: "#", label: "App Store" }],
  },
  {
    id: "3",
    name: "GreenRoute",
    description: "A sustainable transportation planner that optimizes routes to minimize carbon footprint.",
    term: "24S",
    sectors: ["Sustainability", "Transportation"],
    tags: ["Maps", "Node.js", "Vue"],
    teamMembers: ["Morgan Davis", "Riley Kim"],
    coverImage: "https://placehold.co/800x450?text=GreenRoute",
    product: ["Web App"],
    techStack: ["Vue.js", "Node.js", "Google Maps API"],
    projectUrls: [{ url: "#", label: "Try It" }],
  },
  {
    id: "4",
    name: "MindfulMoments",
    description: "A mental wellness app offering guided meditations and mood tracking for college students.",
    term: "23F",
    sectors: ["Health"],
    tags: ["React Native", "Firebase", "UX"],
    teamMembers: ["Sam Wilson", "Casey Brown"],
    coverImage: "https://placehold.co/800x450?text=MindfulMoments",
    product: ["Mobile App"],
    techStack: ["React Native", "Firebase"],
    projectUrls: [],
  },
  {
    id: "5",
    name: "CampusConnect",
    description: "A platform connecting Dartmouth students with campus resources, clubs, and events.",
    term: "23W",
    sectors: ["Social"],
    tags: ["React", "GraphQL", "PostgreSQL"],
    teamMembers: ["Taylor Nguyen", "Drew Martinez"],
    coverImage: "https://placehold.co/800x450?text=CampusConnect",
    product: ["Web App"],
    techStack: ["React", "GraphQL", "PostgreSQL"],
    projectUrls: [{ url: "#", label: "Visit" }],
  },
  {
    id: "6",
    name: "FoodForward",
    description: "Reducing food waste on campus by connecting dining halls with local food banks.",
    term: "23S",
    sectors: ["Sustainability", "Social Impact"],
    tags: ["Django", "React", "Logistics"],
    teamMembers: ["Jamie Clark", "Avery Thomas"],
    coverImage: "https://placehold.co/800x450?text=FoodForward",
    product: ["Web App"],
    techStack: ["Django", "React"],
    projectUrls: [],
  },
];

export default function Projects() {
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTerm, setSelectedTerm] = useState<string>("all");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [displayCount, setDisplayCount] = useState(24);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pageContent, setPageContent] = useState<any[]>([]);
  const [contentLoading, setContentLoading] = useState(false);

  // Refs and useInView hooks for decorative SVGs (Safari compatibility)
  const redFlowerRef = useRef(null);
  const redFlowerInView = useInView(redFlowerRef, { once: false, amount: 0.3 });

  const greenSquareRef = useRef(null);
  const greenSquareInView = useInView(greenSquareRef, { once: false, amount: 0.3 });

  const tealPlantRef = useRef(null);
  const tealPlantInView = useInView(tealPlantRef, { once: false, amount: 0.3 });

  const hasActiveFilters = () => {
    return (
      searchTerm !== "" || selectedTerm !== "all" || selectedTags.length > 0
    );
  };

  const resetFilters = () => {
    setSearchTerm("");
    setSelectedTerm("all");
    setSelectedTags([]);
    setDisplayCount(24);
  };

  // Memoized tag color lookup with cache
  const tagColorCache = useMemo(() => new Map<string, { bg: string; text: string; border: string }>(), []);

  const getTagColor = useCallback((tag: string) => {
    const cached = tagColorCache.get(tag);
    if (cached) return cached;

    const colors = [
      { bg: "bg-[#D4F1F1] dark:bg-[#8CE0D6]", text: "text-[#1A3A52]", border: "border-[#8CE0D6]/30 dark:border-[#8CE0D6]/50" },
      { bg: "bg-[#D4E8F8] dark:bg-[#A8D4F0]", text: "text-[#1A3A52]", border: "border-[#A8D4F0]/30 dark:border-[#A8D4F0]/50" },
      { bg: "bg-[#F8E0E8] dark:bg-[#E8A5B8]", text: "text-[#1A3A52]", border: "border-[#E8A5B8]/30 dark:border-[#E8A5B8]/50" },
      { bg: "bg-[#E8F0D8] dark:bg-[#C5D99F]", text: "text-[#1A3A52]", border: "border-[#C5D99F]/30 dark:border-[#C5D99F]/50" },
      { bg: "bg-[#FFE8E4] dark:bg-[#FFA89C]", text: "text-[#1A3A52]", border: "border-[#FFA89C]/30 dark:border-[#FFA89C]/50" },
      { bg: "bg-[#FFE4E8] dark:bg-[#FFB6C1]", text: "text-[#1A3A52]", border: "border-[#FFB6C1]/30 dark:border-[#FFB6C1]/50" },
    ];

    const hash = tag.split("").reduce((a, b) => {
      a = (a << 5) - a + b.charCodeAt(0);
      return a & a;
    }, 0);

    const result = colors[Math.abs(hash) % colors.length];
    tagColorCache.set(tag, result);
    return result;
  }, [tagColorCache]);

  useEffect(() => {
    setAllProjects(MOCK_PROJECTS);
    setLoading(false);
  }, []);

  // Reset display count when search/filters change
  useEffect(() => {
    setDisplayCount(24);
  }, [searchTerm, selectedTerm, selectedTags]);

  const uniqueTerms = useMemo(() => {
    const terms = new Set<string>();
    allProjects.forEach((project) => {
      if (project.term) terms.add(project.term);
    });
    // Sort by year descending (newest first)
    return Array.from(terms).sort((a, b) => {
      const yearA = parseInt(a);
      const yearB = parseInt(b);
      return yearB - yearA; // Descending order
    });
  }, [allProjects]);

  const uniqueTags = useMemo(() => {
    const tags = new Set<string>();
    allProjects.forEach((project) => {
      project.tags?.forEach((tag) => tags.add(tag));
    });
    return Array.from(tags).sort();
  }, [allProjects]);

  const filteredProjects = useMemo(() => {
    const filtered = allProjects.filter((project) => {
      const matchesSearch =
        searchTerm === "" ||
        project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        project.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        project.teamMembers.some((member) =>
          member.toLowerCase().includes(searchTerm.toLowerCase()),
        ) ||
        project.tags.some((tag) =>
          tag.toLowerCase().includes(searchTerm.toLowerCase()),
        ) ||
        (project.sector &&
          project.sector.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (project.sectors &&
          project.sectors.some((s) =>
            s.toLowerCase().includes(searchTerm.toLowerCase()),
          )) ||
        (project.product &&
          project.product.some((p) =>
            p.toLowerCase().includes(searchTerm.toLowerCase()),
          )) ||
        (project.techStack &&
          project.techStack.some((tech) =>
            tech.toLowerCase().includes(searchTerm.toLowerCase()),
          ));

      const matchesTerm =
        selectedTerm === "all" || project.term === selectedTerm;
      const matchesTags =
        selectedTags.length === 0 ||
        selectedTags.some((tag) => project.tags.includes(tag));

      return matchesSearch && matchesTerm && matchesTags;
    });


    // Sort by year descending (newest first), then by name
    return filtered.sort((a, b) => {
      const yearA = parseInt(a.term) || 0;
      const yearB = parseInt(b.term) || 0;
      if (yearA !== yearB) {
        return yearB - yearA; // Descending order by year
      }
      // If years are the same, sort by name alphabetically
      return a.name.localeCompare(b.name);
    });
  }, [allProjects, searchTerm, selectedTerm, selectedTags]);

  const displayedProjects = filteredProjects.slice(0, displayCount);
  const hasMore = displayCount < filteredProjects.length;

  const handleLoadMore = () => {
    setDisplayCount((prev) => prev + 24);
  };

  const handleProjectClick = async (project: Project) => {
    setSelectedProject(project);
    setModalOpen(true);
    setPageContent([]);
    setContentLoading(true);

    setPageContent([]);
    setContentLoading(false);
  };

  return (
    <div className="min-h-screen bg-white overflow-x-clip">
      <Navbar />

      {/* Hero Section */}
      <div className="mt-[72px] flex h-32 relative overflow-visible">
        <div className="flex-[2] bg-accent-teal flex items-end pl-5 md:pl-10 pr-6 md:pr-12 pb-7 relative z-10">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white">Our Projects</h1>
        </div>
        <div className="flex-[1] relative z-10" style={{ backgroundColor: 'hsl(177 45% 80%)' }}></div>
        {/* Projects blocks overlay */}
        <div
          className="absolute z-20 pointer-events-none"
          style={{ right: '0%', top: '0%', height: '150%', width: 'auto' }}
        >
          <AnimatedBlocksBanner />
        </div>
      </div>

      {/* Technigala Banner */}
      <div className="relative bg-gradient-to-br from-[#FFF8F6] via-white to-[#F0FAFA] py-16 md:py-20 overflow-hidden">
        {/* Decorative SVGs - scattered positioning with animations */}
        {/* Red flower SVG - slightly overlapping with green box */}
        <motion.svg
          ref={redFlowerRef}
          className="absolute top-8 left-14 w-16 h-16 md:w-20 md:h-20 pointer-events-none"
          viewBox="0 0 71 76"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          initial={{ scale: 0, opacity: 0, rotate: -45 }}
          animate={redFlowerInView ? { scale: 1, opacity: 1, rotate: 0 } : { scale: 0, opacity: 0, rotate: -45 }}
          transition={{ delay: 0.2, duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M6.1719 23.2247C-8.68222 40.7909 5.72591 55.0295 23.5012 40.3501C41.273 55.0295 55.6846 40.7774 40.8304 23.2247C55.6846 5.65855 41.273 -8.58008 23.5012 6.09928C5.72591 -8.58008 -8.68222 5.65855 6.1719 23.2247ZM23.5012 31.8178C28.3036 31.8178 32.1966 27.9706 32.1966 23.2247C32.1966 18.4788 28.3036 14.6315 23.5012 14.6315C18.6988 14.6315 14.8057 18.4788 14.8057 23.2247C14.8057 27.9706 18.6988 31.8178 23.5012 31.8178Z"
            fill="#F97979"
          />
        </motion.svg>

        {/* Green square pattern SVG - top left corner */}
        <motion.svg
          ref={greenSquareRef}
          className="absolute top-4 left-4 w-12 h-12 md:w-14 md:h-14 pointer-events-none"
          viewBox="0 0 76 76"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          initial={{ scale: 0, opacity: 0 }}
          animate={greenSquareInView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
          transition={{ delay: 0, duration: 0.5, ease: "easeOut" }}
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M0 75.8948L6.21264e-06 37.9474L8.29367e-07 1.65872e-06L37.9474 0L75.8948 4.13157e-06V37.9474V75.8948H37.9474H0ZM37.9474 56.9109C37.9531 46.4366 46.4457 37.9474 56.9211 37.9474C46.4423 37.9474 37.9474 29.4526 37.9474 18.9737C37.9474 29.4526 29.4526 37.9474 18.9737 37.9474C29.4492 37.9474 37.9419 46.4366 37.9474 56.9109ZM18.9737 47.8137C24.0036 47.8137 28.0811 51.8912 28.0811 56.9211C28.0811 61.951 24.0036 66.0285 18.9737 66.0285C13.9438 66.0285 9.86633 61.951 9.86633 56.9211C9.86633 51.8912 13.9438 47.8137 18.9737 47.8137ZM28.0811 18.9737C28.0811 24.0036 24.0036 28.0811 18.9737 28.0811C13.9438 28.0811 9.86633 24.0036 9.86633 18.9737C9.86633 13.9438 13.9438 9.86633 18.9737 9.86633C24.0036 9.86633 28.0811 13.9438 28.0811 18.9737ZM47.8137 56.9211C47.8137 51.8912 51.8912 47.8137 56.9211 47.8137C61.951 47.8137 66.0285 51.8912 66.0285 56.9211C66.0285 61.951 61.951 66.0285 56.9211 66.0285C51.8912 66.0285 47.8137 61.951 47.8137 56.9211ZM47.8137 18.9737C47.8137 24.0036 51.8912 28.0811 56.9211 28.0811C61.951 28.0811 66.0285 24.0036 66.0285 18.9737C66.0285 13.9439 61.951 9.86633 56.9211 9.86633C51.8912 9.86633 47.8137 13.9438 47.8137 18.9737Z"
            fill="#509C81"
          />
        </motion.svg>

        {/* Teal plant SVG - right side, middle-low */}
        <motion.svg
          ref={tealPlantRef}
          className="absolute bottom-16 right-[5%] w-10 h-12 md:w-12 md:h-14 pointer-events-none"
          viewBox="0 0 47 47"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          initial={{ scale: 0, opacity: 0, y: 20 }}
          animate={tealPlantInView ? { scale: 1, opacity: 1, y: 0 } : { scale: 0, opacity: 0, y: 20 }}
          transition={{ delay: 0.4, duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
        >
          <path
            d="M39.4502 21.6807C43.5522 21.6808 46.8777 24.7333 46.8779 28.499C46.8779 32.265 43.5524 35.3182 39.4502 35.3184C38.8973 35.3184 38.3583 35.2615 37.8398 35.1562C31.8652 34.468 24.6902 29.4967 23.5381 28.6748C24.3407 29.8024 28.771 36.2179 29.8486 41.9355C30.1349 42.7557 30.293 43.6456 30.293 44.5752C30.2926 48.6769 27.2401 52.0025 23.4746 52.0029C19.7088 52.0028 16.6556 48.6771 16.6553 44.5752C16.6553 44.0196 16.7131 43.4778 16.8193 42.957C17.4945 37.1191 22.2546 30.1371 23.2373 28.748C21.8141 29.7537 14.857 34.4868 9.03809 35.1572C8.51957 35.2624 7.98055 35.3193 7.42773 35.3193C3.32559 35.3192 0 32.266 0 28.5C0.000390619 24.7344 3.32586 21.6818 7.42773 21.6816C8.36035 21.6817 9.25277 21.8408 10.0752 22.1289C16.0237 23.2539 22.7239 28.0018 23.4375 28.5166C24.138 28.011 30.8473 23.2542 36.8027 22.1279C37.6252 21.8398 38.5175 21.6807 39.4502 21.6807ZM23.3672 5C27.1331 5 30.1863 8.32559 30.1865 12.4277C30.1865 12.9837 30.1288 13.5258 30.0225 14.0469C29.2679 20.562 23.4277 28.501 23.4277 28.501C23.3911 28.4511 18.1761 21.34 16.9932 15.0684C16.7066 14.248 16.5489 13.3576 16.5488 12.4277C16.549 8.326 19.6017 5.00059 23.3672 5Z"
            fill="#24B1B1"
          />
        </motion.svg>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="flex flex-col lg:flex-row items-center gap-10 lg:gap-16">
            {/* Left Content */}
            <div className="flex-1 text-center lg:text-left order-2 lg:order-1">
              <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-[#1A3A52] mb-4 leading-tight">
                Come see our projects
                <span className="block text-accent-coral">in person at Technigala</span>
              </h2>

              <p className="text-[#1A3A52]/70 text-base md:text-lg leading-relaxed mb-8 max-w-xl">
                Since 2013, Technigala has been the quarterly showcase for innovative DALI and Computer Science projects.
                Join <span className="text-accent-teal font-bold">300+ attendees</span> to see students showing off their latest work!
              </p>

              {/* Event Details Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap justify-center lg:justify-start gap-4">
                <div className="flex items-center gap-3 bg-white px-5 py-3 rounded-xl border-2 border-accent-coral/20 shadow-lg shadow-accent-coral/10">
                  <div className="w-10 h-10 bg-accent-coral/10 rounded-lg flex items-center justify-center">
                    <Calendar className="w-5 h-5 text-accent-coral" />
                  </div>
                  <div className="text-left">
                    <div className="text-[#1A3A52]/50 text-xs uppercase tracking-wide font-medium">Date</div>
                    <div className="text-[#1A3A52] font-bold">Wednesday, June 3rd</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 bg-white px-5 py-3 rounded-xl border-2 border-accent-teal/20 shadow-lg shadow-accent-teal/10">
                  <div className="w-10 h-10 bg-accent-teal/10 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-accent-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <div className="text-[#1A3A52]/50 text-xs uppercase tracking-wide font-medium">Time</div>
                    <div className="text-[#1A3A52] font-bold">6:00 - 8:30 PM</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Image */}
            <div className="w-full lg:w-2/5 order-1 lg:order-2">
              <div className="relative rounded-2xl overflow-hidden shadow-2xl">
                <img
                  src="/assets/projects/technigala.JPG"
                  alt="Technigala event"
                  className="w-full h-64 md:h-72 lg:h-80 object-cover"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        {/* Error State */}
        {error && (
          <Alert className="mb-8 max-w-2xl mx-auto border-red-200 bg-red-50">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800">
              {error}. Showing sample data for demonstration.
            </AlertDescription>
          </Alert>
        )}

        {/* Search and Filter */}
        {!loading && (
          <div className="mb-12 mt-8">
            <div className="max-w-7xl mx-auto">
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <Input
                    placeholder="Search projects..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 h-12 border-gray-300 focus:border-dali-teal focus:ring-dali-teal"
                  />
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm("")}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>
                <Select value={selectedTerm} onValueChange={setSelectedTerm}>
                  <SelectTrigger className="w-full sm:w-48 h-12 border-gray-300 focus:border-dali-teal focus:ring-dali-teal">
                    <Calendar className="w-4 h-4 mr-2" />
                    <SelectValue placeholder="All Years" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Years</SelectItem>
                    {uniqueTerms.map((term) => (
                      <SelectItem key={term} value={term}>
                        {term}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="w-full sm:w-80">
                  <MultiSelect
                    options={uniqueTags}
                    selected={selectedTags}
                    onChange={setSelectedTags}
                    placeholder="Filter by tags..."
                    emptyText="No tags found"
                    className="border-gray-300 focus:border-dali-teal focus:ring-dali-teal"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-dali-teal" />
              <p className="text-gray-600">Loading projects...</p>
            </div>
          </div>
        )}

        {/* Projects Grid */}
        {!loading && (
          <>
            {hasActiveFilters() && (
              <div className="text-center mb-6">
                <p className="text-sm text-gray-600">
                  {searchTerm
                    ? `Showing search results for "${searchTerm}" • ${filteredProjects.length} matching projects`
                    : `Showing ${filteredProjects.length} projects`}
                  {selectedTerm !== "all" &&
                    ` • Filtered by year: ${selectedTerm}`}
                  {selectedTags.length > 0 &&
                    ` • Filtered by tags: ${selectedTags.slice(0, 3).join(", ")}${selectedTags.length > 3 ? ` +${selectedTags.length - 3} more` : ""}`}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {displayedProjects.map((project) => (
                <Card
                  key={project.id}
                  className="group overflow-hidden border-0 shadow-md hover:shadow-xl transition-all duration-300 bg-[#EDF4FC] dark:bg-[#1A3A52] text-gray-900 dark:text-white cursor-pointer"
                  onClick={() => handleProjectClick(project)}
                >
                  <CardContent className="p-0">
                    {/* Project Image */}
                    {project.coverImage && (
                      <div className="h-40 sm:h-44 md:h-48 overflow-hidden bg-gray-100 relative">
                        <img
                          src={project.coverImage}
                          alt={project.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                        {/* Links Overlay */}
                        <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex gap-2">
                          {project.projectUrls && project.projectUrls.length > 0 && (
                            <Button
                              size="sm"
                              className="bg-white/90 hover:bg-white text-gray-900 shadow-lg"
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(project.projectUrls[0].url, "_blank");
                              }}
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Project Info */}
                    <div className="p-4 sm:p-5 md:p-6">
                      <h3 className="font-semibold text-lg sm:text-xl text-gray-900 dark:text-white mb-2 leading-tight">
                        {project.name}
                      </h3>

                      <p className="text-gray-600 dark:text-gray-300 mb-4">
                        {project.description || "No description available"}
                      </p>

                      <div className="flex items-center gap-4 mb-3">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-gray-400 dark:text-gray-300" />
                          <span className="text-sm text-gray-600 dark:text-gray-300">
                            {project.term}
                          </span>
                        </div>
                        {project.sector && (
                          <div className="flex items-center gap-1">
                            <span className="text-sm text-gray-600 dark:text-gray-300 font-medium">
                              {project.sector}
                            </span>
                          </div>
                        )}
                      </div>

                      {project.tags.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-3">
                          {project.tags.slice(0, 3).map((tag, index) => {
                            const colors = getTagColor(tag);
                            return (
                              <span
                                key={index}
                                className={`inline-block px-2 py-1 text-xs font-medium rounded border ${colors.bg} ${colors.text} ${colors.border}`}
                              >
                                {tag}
                              </span>
                            );
                          })}
                          {project.tags.length > 3 && (
                            <span className="inline-block px-2 py-1 text-xs font-medium rounded border bg-gray-100 dark:bg-white/20 text-gray-700 dark:text-white border-gray-200 dark:border-white/30">
                              +{project.tags.length - 3} more
                            </span>
                          )}
                        </div>
                      )}

                      {project.teamMembers.length > 0 && (
                        <div className="border-t border-gray-200 dark:border-white/20 pt-3">
                          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                            <Users className="h-4 w-4" />
                            <span className="line-clamp-1">
                              {project.teamMembers.slice(0, 2).join(", ")}
                              {project.teamMembers.length > 2 &&
                                ` +${project.teamMembers.length - 2} more`}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* No Results */}
            {filteredProjects.length === 0 && (
              <div className="text-center py-24">
                <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-gray-100 flex items-center justify-center">
                  <Search className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  No projects found
                </h3>
                <p className="text-gray-600">
                  Try adjusting your search or filter criteria
                </p>
              </div>
            )}

            {/* Load More */}
            {hasMore && (
              <div className="flex justify-center mt-16">
                <Button
                  onClick={handleLoadMore}
                  className="bg-dali-green hover:bg-dali-green/90 text-white px-8 py-3 font-medium"
                  size="lg"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Load More ({filteredProjects.length - displayCount} remaining)
                </Button>
              </div>
            )}
          </>
        )}
      </main>

      {/* Interested in how we built these? Section
      <section className="py-20 bg-accent-teal">
        <div className="max-w-4xl mx-auto text-center px-4">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-8 text-dark-blue">
            Interested in how we built these?
          </h2>
          <Button
            asChild
            className="bg-accent-teal hover:bg-accent-teal/90 text-white px-8 py-6 rounded-lg text-lg font-medium shadow-md transition-colors"
          >
            <a href="https://dali.dartmouth.edu/techstacks">
              LEARN MORE
            </a>
          </Button>
        </div>
      </section> */}

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-8 sm:py-10 md:py-12 px-4 sm:px-6 md:px-8">
        <div className="max-w-8xl mx-auto flex flex-col sm:flex-row sm:justify-between sm:items-stretch">
          <div className="text-center sm:text-left flex flex-col sm:justify-between">
            {/* Address and email at top */}
            <div>
              <p className="mb-3 ml-0 sm:ml-[4rem] text-base sm:text-lg">15 Engineering Drive, ECSC 002, Hanover, NH, 03755</p>
              <a href="mailto:contact@dali.dartmouth.edu" className="text-white sm:ml-[4rem] hover:underline text-sm sm:text-base">
                contact@dali.dartmouth.edu
              </a>
            </div>

            {/* Social Links at bottom */}
            <div className="flex flex-wrap justify-center sm:justify-start text-center sm:text-left ml-0 sm:ml-[4rem] gap-4 sm:gap-5 md:gap-6 mt-6 sm:mt-0">
              <a href="https://www.linkedin.com/school/dali-lab" target="_blank" rel="noopener noreferrer" className="hover:text-dali-teal text-sm sm:text-base transition">
                LinkedIn
              </a>
              <a href="https://www.instagram.com/dartmouth_dali_lab/" target="_blank" rel="noopener noreferrer" className="hover:text-dali-teal text-sm sm:text-base transition">
                Instagram
              </a>
              <a href="https://www.facebook.com/dartmouth.dali.lab" target="_blank" rel="noopener noreferrer" className="hover:text-dali-teal text-sm sm:text-base transition">
                Facebook
              </a>
              <a href="https://twitter.com/DALI_Lab" target="_blank" rel="noopener noreferrer" className="hover:text-dali-teal text-sm sm:text-base transition">
                Twitter
              </a>
            </div>
          </div>
          <div className="hidden sm:flex pr-[4rem] pointer-events-none">
            <img
              src="assets/landingpage/footer.png"
              alt="Footer graphic"
              className="max-w-[350px] w-auto h-auto"
            />
          </div>
        </div>
      </footer>

      {/* Project Detail Panel */}
      <AnimatePresence>
        {modalOpen && selectedProject && (
          <>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/40 z-40"
              onClick={() => setModalOpen(false)}
            />

            {/* Slide-in panel */}
            <motion.div
              key="panel"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed top-0 right-0 h-full w-full sm:w-[480px] md:w-[560px] bg-white dark:bg-gray-900 z-50 shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Cover image */}
              {selectedProject.coverImage ? (
                <div className="h-52 shrink-0 overflow-hidden relative">
                  <img
                    src={selectedProject.coverImage}
                    alt={selectedProject.name}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                  <button
                    onClick={() => setModalOpen(false)}
                    className="absolute top-4 right-4 p-1.5 rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between px-6 pt-6 pb-2 shrink-0">
                  <div />
                  <button
                    onClick={() => setModalOpen(false)}
                    className="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white leading-tight">
                    {selectedProject.name}
                  </h2>
                  {selectedProject.description && (
                    <p className="mt-2 text-gray-600 dark:text-gray-300 text-sm leading-relaxed">
                      {selectedProject.description}
                    </p>
                  )}
                </div>

                {/* Year and Sector */}
                <div className="flex flex-wrap gap-4">
                  <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
                    <Calendar className="h-4 w-4" />
                    <span>{selectedProject.term}</span>
                  </div>
                  {(selectedProject.sector || (selectedProject.sectors && selectedProject.sectors.length > 0)) && (
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      Sector:{" "}
                      <span className="font-medium text-gray-700 dark:text-gray-200">
                        {selectedProject.sectors?.length
                          ? selectedProject.sectors.join(", ")
                          : selectedProject.sector}
                      </span>
                    </div>
                  )}
                </div>

                {/* Product */}
                {selectedProject.product && selectedProject.product.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Product</p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedProject.product.map((item, i) => {
                        const colors = getTagColor(item);
                        return (
                          <Badge key={i} variant="outline" className={`${colors.bg} ${colors.text} ${colors.border} border text-xs`}>
                            {item}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Tech Stack */}
                {selectedProject.techStack && selectedProject.techStack.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Tech Stack</p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedProject.techStack.map((tech, i) => {
                        const colors = getTagColor(tech);
                        return (
                          <Badge key={i} variant="outline" className={`${colors.bg} ${colors.text} ${colors.border} border text-xs`}>
                            {tech}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Tags fallback */}
                {(!selectedProject.product || selectedProject.product.length === 0) &&
                  (!selectedProject.techStack || selectedProject.techStack.length === 0) &&
                  selectedProject.tags.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Technologies & Categories</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedProject.tags.map((tag, i) => {
                          const colors = getTagColor(tag);
                          return (
                            <Badge key={i} variant="outline" className={`${colors.bg} ${colors.text} ${colors.border} border text-xs`}>
                              {tag}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                  )}

                {/* Partners */}
                {selectedProject.teamMembers.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Partners</p>
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                      <Users className="h-4 w-4 shrink-0" />
                      <span>{selectedProject.teamMembers.join(", ")}</span>
                    </div>
                  </div>
                )}

                {/* Links */}
                {selectedProject.projectUrls && selectedProject.projectUrls.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Links</p>
                    <div className="flex flex-col gap-2">
                      {selectedProject.projectUrls.map((link, i) => (
                        <a
                          key={i}
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-sm text-dali-teal hover:text-dali-teal-dark transition-colors"
                        >
                          <ExternalLink className="h-4 w-4" />
                          {link.label}
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Page Content */}
                <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Project Details</p>
                  {contentLoading ? (
                    <div className="flex items-center gap-2 py-6 text-gray-400">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span className="text-sm">Loading content...</span>
                    </div>
                  ) : pageContent.length > 0 ? (
                    <NotionRenderer blocks={pageContent} />
                  ) : (
                    <p className="text-sm text-gray-400 italic">No additional content available</p>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
