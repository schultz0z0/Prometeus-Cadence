import {AppShell} from '@/components/shell/app-shell';
import {DemoProvider} from '@/demo/provider';
export default function AppLayout({children}:{children:React.ReactNode}){return <DemoProvider><AppShell>{children}</AppShell></DemoProvider>;}
