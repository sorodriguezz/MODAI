export interface UsersTable {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: string;
  project_ids_json: string;
  organization_ids_json: string;
  package_scopes_json: string;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  disabled_at: string | null;
  mfa_secret: string | null;
  mfa_last_step: number | null;
  mfa_recovery_json: string | null;
}
