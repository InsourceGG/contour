import { AuthPage, type Search } from "@/components/AuthPage";
export default function Login({ searchParams }: { searchParams: Search }) { return <AuthPage signup={false} searchParams={searchParams}/>; }
