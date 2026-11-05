import type { Role } from "@tutlab/shared";

export function homeForRole(role: Role): "/today" | "/schedule" {
  return role === "teacher" ? "/today" : "/schedule";
}
