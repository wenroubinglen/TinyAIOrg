type OfficeLayoutProps = {
  children: React.ReactNode;
};

// Layout shell for office routes; content is rendered as-is for now.
export default function OfficeLayout({ children }: OfficeLayoutProps) {
  return <>{children}</>;
}
