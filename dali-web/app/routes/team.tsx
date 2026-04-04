import { useState, useMemo, useEffect, memo, useCallback } from "react";

import Navbar from "@/components/Navbar";
import AnimatedBlocksBanner from "@/components/AnimatedBlocksBanner";
import {
  Search,
  Filter,
  ExternalLink,
  Calendar,
  AlertCircle,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
interface TeamMember {
  id: string;
  name: string;
  year: string | number;
  roles: string[];
  coreRoleNames?: string[];
  termsInDali: string[];
  profileImage: string;
  linkedinUrl: string;
}

const MOCK_TEAM_MEMBERS: TeamMember[] = [
  { id: "1", name: "Tim Tregubov", year: 2024, roles: ["Staff"], coreRoleNames: ["Director"], termsInDali: ["24F","24X","24S","24W"], profileImage: "https://placehold.co/400x400?text=TT", linkedinUrl: "#" },
  { id: "2", name: "Madison Dunaway", year: 2024, roles: ["Staff"], coreRoleNames: ["Program Manager"], termsInDali: ["24F","24X"], profileImage: "https://placehold.co/400x400?text=MD", linkedinUrl: "#" },
  { id: "3", name: "Alice Chen", year: 2025, roles: ["Full Stack"], coreRoleNames: [], termsInDali: ["24F","24X","24S"], profileImage: "https://placehold.co/400x400?text=AC", linkedinUrl: "https://linkedin.com" },
  { id: "4", name: "Ben Park", year: 2026, roles: ["UI/UX"], coreRoleNames: [], termsInDali: ["24F","24X"], profileImage: "https://placehold.co/400x400?text=BP", linkedinUrl: "https://linkedin.com" },
  { id: "5", name: "Cora James", year: 2025, roles: ["Data"], coreRoleNames: [], termsInDali: ["24W","24S","24X","24F"], profileImage: "https://placehold.co/400x400?text=CJ", linkedinUrl: "#" },
  { id: "6", name: "David Liu", year: 2026, roles: ["PM"], coreRoleNames: [], termsInDali: ["24F"], profileImage: "https://placehold.co/400x400?text=DL", linkedinUrl: "https://linkedin.com" },
  { id: "7", name: "Eva Rodriguez", year: 2025, roles: ["AR/VR"], coreRoleNames: [], termsInDali: ["24S","24X","24F"], profileImage: "https://placehold.co/400x400?text=ER", linkedinUrl: "#" },
  { id: "8", name: "Frank Kim", year: 2027, roles: ["Full Stack"], coreRoleNames: [], termsInDali: ["24F"], profileImage: "https://placehold.co/400x400?text=FK", linkedinUrl: "https://linkedin.com" },
  { id: "9", name: "Grace Wu", year: 2025, roles: ["UI/UX", "PM"], coreRoleNames: [], termsInDali: ["24W","24S","24X","24F"], profileImage: "https://placehold.co/400x400?text=GW", linkedinUrl: "#" },
  { id: "10", name: "Henry Zhao", year: 2026, roles: ["Engines"], coreRoleNames: [], termsInDali: ["24X","24F"], profileImage: "https://placehold.co/400x400?text=HZ", linkedinUrl: "https://linkedin.com" },
  { id: "11", name: "Iris Thompson", year: 2025, roles: ["Video"], coreRoleNames: [], termsInDali: ["24S","24X","24F"], profileImage: "https://placehold.co/400x400?text=IT", linkedinUrl: "#" },
  { id: "12", name: "Jack Morrison", year: 2026, roles: ["3D Modeling"], coreRoleNames: [], termsInDali: ["24F"], profileImage: "https://placehold.co/400x400?text=JM", linkedinUrl: "https://linkedin.com" },
];

// Color constants for roles (lighter in light mode, brighter in dark mode)
const ROLE_COLORS = [
  { bg: "bg-[#D4F1F1] dark:bg-[#8CE0D6]", text: "text-[#1A3A52]", border: "border-[#8CE0D6]/30 dark:border-[#8CE0D6]/50" },
  { bg: "bg-[#D4E8F8] dark:bg-[#A8D4F0]", text: "text-[#1A3A52]", border: "border-[#A8D4F0]/30 dark:border-[#A8D4F0]/50" },
  { bg: "bg-[#F8E0E8] dark:bg-[#E8A5B8]", text: "text-[#1A3A52]", border: "border-[#E8A5B8]/30 dark:border-[#E8A5B8]/50" },
  { bg: "bg-[#E8F0D8] dark:bg-[#C5D99F]", text: "text-[#1A3A52]", border: "border-[#C5D99F]/30 dark:border-[#C5D99F]/50" },
  { bg: "bg-[#FFE8E4] dark:bg-[#FFA89C]", text: "text-[#1A3A52]", border: "border-[#FFA89C]/30 dark:border-[#FFA89C]/50" },
  { bg: "bg-[#FFE4E8] dark:bg-[#FFB6C1]", text: "text-[#1A3A52]", border: "border-[#FFB6C1]/30 dark:border-[#FFB6C1]/50" },
];

const TERM_COLOR = { bg: "bg-gray-100 dark:bg-white/20", text: "text-gray-700 dark:text-white", border: "border-gray-200 dark:border-white/30" };

// Helper function for role colors (moved outside component)
const getRoleColorStatic = (role: string) => {
  const hash = role.split("").reduce((a, b) => {
    a = (a << 5) - a + b.charCodeAt(0);
    return a & a;
  }, 0);
  return ROLE_COLORS[Math.abs(hash) % ROLE_COLORS.length];
};

// Fallback image SVG
const FALLBACK_IMAGE = `data:image/svg+xml,${encodeURIComponent(`
  <svg width="400" height="400" viewBox="0 0 400 400" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="400" height="400" fill="#f3f4f6"/>
    <path d="M200 180c33.137 0 60-26.863 60-60s-26.863-60-60-60-60 26.863-60 60 26.863 60 60 60zM200 210c-40 0-120 20-120 60v20h240v-20c0-40-80-60-120-60z" fill="#9ca3af"/>
  </svg>
`)}`;

// Memoized Team Member Card component
const TeamMemberCard = memo(function TeamMemberCard({
  member,
  combinedTerms,
}: {
  member: TeamMember;
  combinedTerms: string[];
}) {
  const handleImageError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    e.currentTarget.src = FALLBACK_IMAGE;
  }, []);

  const handleLinkedInClick = useCallback(() => {
    window.open(member.linkedinUrl, "_blank");
  }, [member.linkedinUrl]);

  return (
    <Card className="group overflow-hidden border-0 shadow-md hover:shadow-xl transition-all duration-300 bg-white dark:bg-[#1A3A52] text-gray-900 dark:text-white">
      <CardContent className="p-0">
        {/* Profile Image */}
        <div className="aspect-square relative overflow-hidden bg-gray-100">
          <img
            src={member.profileImage}
            alt={member.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
            onError={handleImageError}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

          {/* LinkedIn Button Overlay */}
          {member.linkedinUrl && member.linkedinUrl !== "#" && (
            <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <Button
                size="sm"
                className="bg-white/90 hover:bg-white text-gray-900 shadow-lg"
                onClick={handleLinkedInClick}
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>

        {/* Member Info */}
        <div className="p-4">
          <h3 className="font-semibold text-base text-gray-900 dark:text-white mb-1 leading-tight">
            {member.name}
          </h3>

          <div className="flex flex-wrap gap-1 mb-2">
            {[...new Set([...(member.roles || []), ...(member.coreRoleNames || [])])].map((role, index) => {
              const colors = getRoleColorStatic(role);
              return (
                <span
                  key={index}
                  className={`inline-block px-2 py-1 text-xs font-medium rounded border ${colors.bg} ${colors.text} ${colors.border}`}
                >
                  {role}
                </span>
              );
            })}
          </div>

          <div className="space-y-2 text-xs text-gray-600 dark:text-gray-300">
            <div className="flex items-center">
              <Calendar className="w-3 h-3 mr-1 text-gray-400 dark:text-gray-300" />
              <span>Class of {member.year}</span>
            </div>
            <div>
              <div className="flex flex-wrap gap-1">
                {combinedTerms.map((term, index) => (
                  <span
                    key={index}
                    className={`inline-block px-1.5 py-0.5 text-xs font-medium rounded border ${TERM_COLOR.bg} ${TERM_COLOR.text} ${TERM_COLOR.border}`}
                  >
                    {term}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

export default function Team() {
  const [allTeamMembers, setAllTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRole, setSelectedRole] = useState<string>("all");
  const [selectedTerm, setSelectedTerm] = useState<string>("all");
  const [displayCount, setDisplayCount] = useState(48); // Show 48 members initially

  // Hardcoded staff members
  const STAFF_NAMES = ["Tim Tregubov", "Madison Dunaway", "Pape Sow Traore", "Lorie Loeb"];

  // Function to check if any filters are active
  const hasActiveFilters = () => {
    return (
      searchTerm !== "" || selectedRole !== "all" || selectedTerm !== "all"
    );
  };

  // Function to reset all filters
  const resetFilters = () => {
    setSearchTerm("");
    setSelectedRole("all");
    setSelectedTerm("all");
    setDisplayCount(48);
  };

  // Function to combine consecutive terms into ranges
  const combineConsecutiveTerms = (terms: string[]): string[] => {
    if (terms.length <= 1) return terms;

    // Sort terms first using the same logic as sortTerms
    const sortedTerms = [...terms].sort((a, b) => {
      const yearA = a.slice(0, 2);
      const seasonA = a.slice(2);
      const yearB = b.slice(0, 2);
      const seasonB = b.slice(2);

      const yearNumA = parseInt(yearA, 10);
      const yearNumB = parseInt(yearB, 10);

      if (yearNumA !== yearNumB) {
        return yearNumA - yearNumB; // Ascending order for combining
      }

      const seasonOrder = { W: 0, S: 1, X: 2, F: 3 };
      const seasonRankA = seasonOrder[seasonA as keyof typeof seasonOrder] ?? 4;
      const seasonRankB = seasonOrder[seasonB as keyof typeof seasonOrder] ?? 4;

      return seasonRankA - seasonRankB;
    });

    const result: string[] = [];
    let startTerm = sortedTerms[0];
    let endTerm = sortedTerms[0];
    let runLength = 1;

    for (let i = 1; i < sortedTerms.length; i++) {
      const currentTerm = sortedTerms[i];
      const prevTerm = sortedTerms[i - 1];

      // Check if terms are consecutive
      const isConsecutive = areTermsConsecutive(prevTerm, currentTerm);

      if (isConsecutive) {
        endTerm = currentTerm;
        runLength += 1;
      } else {
        // Add the previous run based on its length
        if (runLength === 1) {
          result.push(startTerm);
        } else if (runLength === 2) {
          result.push(startTerm, endTerm);
        } else {
          result.push(`${startTerm}-${endTerm}`);
        }
        // Start new run
        startTerm = currentTerm;
        endTerm = currentTerm;
        runLength = 1;
      }
    }

    // Add the last range or single term
    if (runLength === 1) {
      result.push(startTerm);
    } else if (runLength === 2) {
      result.push(startTerm, endTerm);
    } else {
      result.push(`${startTerm}-${endTerm}`);
    }

    return result;
  };

  // Helper function to check if two terms are consecutive
  const areTermsConsecutive = (term1: string, term2: string): boolean => {
    const year1 = parseInt(term1.slice(0, 2), 10);
    const season1 = term1.slice(2);
    const year2 = parseInt(term2.slice(0, 2), 10);
    const season2 = term2.slice(2);

    const seasonOrder = { W: 0, S: 1, X: 2, F: 3 };
    const seasonRank1 = seasonOrder[season1 as keyof typeof seasonOrder] ?? 4;
    const seasonRank2 = seasonOrder[season2 as keyof typeof seasonOrder] ?? 4;

    // Calculate the total "term number" for comparison
    const termNumber1 = year1 * 4 + seasonRank1;
    const termNumber2 = year2 * 4 + seasonRank2;

    return termNumber2 === termNumber1 + 1;
  };

  useEffect(() => {
    setAllTeamMembers(MOCK_TEAM_MEMBERS);
    setLoading(false);
  }, []);

  // Reset display count when filters change
  useEffect(() => {
    setDisplayCount(48);
  }, [searchTerm, selectedRole, selectedTerm]);

  const allRoles = useMemo(() => {
    const roles = new Set<string>();
    allTeamMembers.forEach((member) => {
      (member.roles || []).forEach((role) => roles.add(role));
      (member.coreRoleNames || []).forEach((role) => roles.add(role));
    });
    return Array.from(roles).sort();
  }, [allTeamMembers]);

  const allTerms = useMemo(() => {
    const terms = new Set<string>();
    allTeamMembers.forEach((member) => {
      (member.termsInDali || []).forEach((term) => terms.add(term));
    });

    const sortTerms = (a: string, b: string) => {
      const yearA = a.slice(0, 2);
      const seasonA = a.slice(2);
      const yearB = b.slice(0, 2);
      const seasonB = b.slice(2);

      const yearNumA = parseInt(yearA, 10);
      const yearNumB = parseInt(yearB, 10);

      if (yearNumA !== yearNumB) {
        return yearNumB - yearNumA;
      }

      const seasonOrder = { F: 0, X: 1, S: 2, W: 3 };
      const seasonRankA = seasonOrder[seasonA as keyof typeof seasonOrder] ?? 4;
      const seasonRankB = seasonOrder[seasonB as keyof typeof seasonOrder] ?? 4;

      return seasonRankA - seasonRankB;
    };

    return Array.from(terms).sort(sortTerms);
  }, [allTeamMembers]);

  const filteredMembers = useMemo(() => {
    return allTeamMembers.filter((member) => {
      const combinedTerms = combineConsecutiveTerms(
        member.termsInDali || [],
      );
      const matchesSearch =
        searchTerm === "" ||
        member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        [...(member.roles || []), ...(member.coreRoleNames || [])].some((role) =>
          role.toLowerCase().includes(searchTerm.toLowerCase()),
        ) ||
        member.termsInDali.some((term) =>
          term.toLowerCase().includes(searchTerm.toLowerCase()),
        ) ||
        combinedTerms.some((term) =>
          term.toLowerCase().includes(searchTerm.toLowerCase()),
        );
      const matchesRole =
        selectedRole === "all" || member.roles.includes(selectedRole) || (member.coreRoleNames || []).includes(selectedRole);
      const matchesTerm =
        selectedTerm === "all" ||
        member.termsInDali.includes(selectedTerm);

      return matchesSearch && matchesRole && matchesTerm;
    });
  }, [allTeamMembers, searchTerm, selectedRole, selectedTerm]);

  const displayedMembers = useMemo(() => {
    // Staff-first ordering: hardcoded staff names appear first
    const staffMembers = filteredMembers.filter((m) =>
      STAFF_NAMES.some(staffName => m.name.toLowerCase() === staffName.toLowerCase())
    );
    const nonStaffMembers = filteredMembers.filter((m) =>
      !STAFF_NAMES.some(staffName => m.name.toLowerCase() === staffName.toLowerCase())
    );
    const ordered = [...staffMembers, ...nonStaffMembers];
    return ordered.slice(0, displayCount);
  }, [filteredMembers, displayCount]);

  const hasMore = displayCount < filteredMembers.length;

  const handleLoadMore = () => {
    setDisplayCount((prev) => prev + 48);
  };

  return (
    <div className="min-h-screen bg-white overflow-x-clip">
      <Navbar />

      {/* Hero Section */}
      <div className="mt-[72px] flex h-32 relative overflow-visible">
        <div className="flex-[2] bg-accent-coral flex items-end pl-5 md:pl-10 pr-6 md:pr-12 pb-7 relative z-10">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white">Our Team</h1>
        </div>
        <div className="flex-[1] bg-accent-coral-light relative z-10"></div>
        {/* Projects blocks overlay */}
        <div
          className="absolute z-20 pointer-events-none"
          style={{ right: '0%', top: '0%', height: '150%', width: 'auto' }}
        >
          <AnimatedBlocksBanner />
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
          <div className="mb-12">
            <div className="max-w-2xl mx-auto">
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <Input
                    placeholder="Search team members..."
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
                <Select value={selectedRole} onValueChange={setSelectedRole}>
                  <SelectTrigger className="w-full sm:w-48 h-12 border-gray-300 focus:border-dali-teal focus:ring-dali-teal">
                    <Filter className="w-4 h-4 mr-2" />
                    <SelectValue placeholder="All Roles" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Roles</SelectItem>
                    {allRoles.map((role) => (
                      <SelectItem key={role} value={role}>
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={selectedTerm} onValueChange={setSelectedTerm}>
                  <SelectTrigger className="w-full sm:w-48 h-12 border-gray-300 focus:border-dali-teal focus:ring-dali-teal">
                    <Calendar className="w-4 h-4 mr-2" />
                    <SelectValue placeholder="All Terms" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Terms</SelectItem>
                    {allTerms.map((term) => (
                      <SelectItem key={term} value={term}>
                        {term}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {hasActiveFilters() && (
                  <Button
                    onClick={resetFilters}
                    variant="outline"
                    className="h-12 px-4 border-gray-300 hover:bg-gray-50 text-gray-700"
                  >
                    <X className="w-4 h-4 mr-2" />
                    Reset
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-dali-teal" />
              <p className="text-gray-600">Loading team members...</p>
            </div>
          </div>
        )}

        {/* Team Grid */}
        {!loading && (
          <>
            {hasActiveFilters() && (
              <div className="text-center mb-6">
                <p className="text-sm text-gray-600">
                  {searchTerm
                    ? `Showing search results for "${searchTerm}" • ${filteredMembers.length} matching members`
                    : `Showing ${filteredMembers.length} members`}
                  {selectedTerm !== "all" &&
                    ` • Filtered by term: ${selectedTerm}`}
                  {selectedRole !== "all" &&
                    ` • Filtered by role: ${selectedRole}`}
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
              {displayedMembers.map((member) => (
                <TeamMemberCard
                  key={member.id}
                  member={member}
                  combinedTerms={combineConsecutiveTerms(member.termsInDali || [])}
                />
              ))}
            </div>

            {/* No Results */}
            {filteredMembers.length === 0 && (
              <div className="text-center py-24">
                <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-gray-100 flex items-center justify-center">
                  <Search className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  No team members found
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
                  Load More ({filteredMembers.length - displayCount} remaining)
                </Button>
              </div>
            )}
          </>
        )}
      </main>

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
    </div>
  );
}
