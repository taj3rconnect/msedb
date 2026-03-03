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
  ruleFilter: string;
  onStatusChange: (status: string) => void;
  onPatternTypeChange: (type: string) => void;
  onRuleFilterChange: (value: string) => void;
}

export function PatternFilters({
  status,
  patternType,
  ruleFilter,
  onStatusChange,
  onPatternTypeChange,
  onRuleFilterChange,
}: PatternFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
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

      <Select value={ruleFilter} onValueChange={onRuleFilterChange}>
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="All Rules" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Rules</SelectItem>
          <SelectItem value="has-rule">Has Rule</SelectItem>
          <SelectItem value="no-rule">No Rule</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
