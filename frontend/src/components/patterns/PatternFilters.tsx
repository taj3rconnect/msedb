import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface PatternFiltersProps {
  status: string;
  patternType: string;
  onStatusChange: (status: string) => void;
  onPatternTypeChange: (type: string) => void;
}

/**
 * Filter controls for the patterns page.
 * Status dropdown and pattern type dropdown in a flex row.
 */
export function PatternFilters({
  status,
  patternType,
  onStatusChange,
  onPatternTypeChange,
}: PatternFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Status Filter */}
      <Select value={status} onValueChange={onStatusChange}>
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="All Statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          <SelectItem value="detected">Detected</SelectItem>
          <SelectItem value="suggested">Suggested</SelectItem>
          <SelectItem value="approved">Approved</SelectItem>
          <SelectItem value="rejected">Rejected</SelectItem>
        </SelectContent>
      </Select>

      {/* Pattern Type Filter */}
      <Select value={patternType} onValueChange={onPatternTypeChange}>
        <SelectTrigger className="w-[170px]">
          <SelectValue placeholder="All Types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Types</SelectItem>
          <SelectItem value="sender">Sender</SelectItem>
          <SelectItem value="folder-routing">Folder Routing</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
