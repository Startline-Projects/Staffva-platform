import { getUser } from "@/lib/auth";
import DropdownNavbar from "./DropdownNavbar";

export default async function Navbar() {
  const user = await getUser();
  const role = user?.app_metadata?.role as string | undefined;

  return (
    <DropdownNavbar
      user={user ? { role } : null}
      variant="light"
    />
  );
}
