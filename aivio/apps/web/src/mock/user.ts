export const mockCurrentUser = {
  name: "Creator",
  role: "user" as "user" | "admin"
};

export const mockAdminUser = {
  name: "Admin",
  role: "admin" as const
};
