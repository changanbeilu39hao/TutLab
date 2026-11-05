import type { Role } from "@tutlab/shared";

export function homeForRole(role: Role): "/today" | "/concerns" {
  return role === "teacher" ? "/today" : "/concerns";
}
