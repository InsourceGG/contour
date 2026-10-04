import { AuthPage, type Search } from "@/components/AuthPage";
export default function Signup({ searchParams }: { searchParams: Search }) { return <AuthPage signup searchParams={searchParams}/>; }
