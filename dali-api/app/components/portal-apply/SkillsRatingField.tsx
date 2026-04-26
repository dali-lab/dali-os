export function SkillsRatingField({
  skills,
  value,
  onChange,
}: {
  skills: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  // Parse "Skill: N\nSkill: N" into a map
  const ratings: Record<string, string> = {};
  if (value) {
    for (const line of value.split("\n")) {
      const idx = line.lastIndexOf(":");
      if (idx > 0) {
        const skill = line.slice(0, idx).trim();
        const rating = line.slice(idx + 1).trim();
        ratings[skill] = rating;
      }
    }
  }

  function setRating(skill: string, rating: string) {
    const updated = { ...ratings, [skill]: rating };
    const serialized = skills
      .map(s => `${s}: ${updated[s] ?? "0"}`)
      .join("\n");
    onChange(serialized);
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
      {skills.map(skill => (
        <div key={skill} className="flex items-center justify-between gap-2 py-1">
          <span className="text-sm text-dark-blue truncate">{skill}</span>
          <select
            value={ratings[skill] ?? "0"}
            onChange={e => setRating(skill, e.target.value)}
            className="w-14 shrink-0 rounded-md border border-gray-200 bg-white text-sm text-center text-dark-blue py-1 focus:outline-none focus:border-accent-coral"
          >
            {["0", "1", "2", "3", "4", "5"].map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}
