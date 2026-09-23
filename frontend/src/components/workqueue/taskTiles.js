import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  LayoutList,
  PlayCircle,
  ShieldCheck,
} from "lucide-react";
/**
 * The six status tiles Delegation and Loop Tasks both show.
 *
 * Both pages ribbon the SAME six statuses, so both read this one list: an icon
 * or a tone chosen for "Awaiting Verification" is chosen once, and the two
 * screens cannot label the same status differently.
 *
 * `countKey` is where the count lives on each page's counts object — the two
 * services disagree only about whether the total is called `All` or `Total`.
 */
export const TASK_STATUS_TILES = [
  { key: "All", countKey: "Total", label: "Total", icon: LayoutList, tone: "neutral" },
  { key: "Overdue", countKey: "Overdue", label: "Overdue", icon: AlertTriangle, tone: "danger" },
  { key: "Pending", countKey: "Pending", label: "Pending", icon: Clock, tone: "neutral" },
  { key: "In Progress", countKey: "In Progress", label: "In Progress", icon: PlayCircle, tone: "warning" },
  { key: "Awaiting Verification", countKey: "Awaiting Verification", label: "Verification", icon: ShieldCheck, tone: "primary" },
  { key: "Completed", countKey: "Completed", label: "Completed", icon: CheckCircle2, tone: "success" },
];
