import { createClient } from "@/lib/supabase/server";
import AnnouncementBar from "@/components/landing/AnnouncementBar";
import LandingNavbar from "@/components/landing/LandingNavbar";
import HeroSection from "@/components/landing/HeroSection";
import CommonSearchesSection from "@/components/landing/CommonSearchesSection";
import BrowseByRoleSection from "@/components/landing/BrowseByRoleSection";
import LiveCandidatesSection from "@/components/landing/LiveCandidatesSection";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import WhyStaffVASection from "@/components/landing/WhyStaffVASection";
import ForCandidatesSection from "@/components/landing/ForCandidatesSection";
import FinalCTASection from "@/components/landing/FinalCTASection";
import Footer from "@/components/landing/Footer";
import QuickMatchButton from "@/components/landing/QuickMatchButton";

export default async function Home() {
  const supabase = await createClient();

  // Fetch approved available candidates for hero preview + live section
  const { data: candidates } = await supabase
    .from("candidates")
    .select(
      "id, display_name, country, role_category, monthly_rate, english_written_tier, speaking_level, availability_status, total_earnings_usd, lock_status, bio, us_client_experience, profile_photo_url"
    )
    .eq("admin_status", "approved")
    .order("created_at", { ascending: false })
    .limit(12);

  const allCandidates = candidates || [];
  const availableCandidates = allCandidates.filter(
    (c) => c.availability_status === "available_now" && c.lock_status !== "locked"
  );
  const heroPreview = availableCandidates.slice(0, 3);
  const liveCandidates = availableCandidates.slice(0, 6);

  // Stats for "For Candidates" section
  const { count: totalApproved } = await supabase
    .from("candidates")
    .select("*", { count: "exact", head: true })
    .eq("admin_status", "approved");

  const { data: countryData } = await supabase
    .from("candidates")
    .select("country")
    .eq("admin_status", "approved");

  const uniqueCountries = new Set(countryData?.map((c) => c.country)).size;

  return (
    <main className="overflow-x-hidden">
      <AnnouncementBar />
      <LandingNavbar />
      <HeroSection heroPreview={heroPreview} />
      <CommonSearchesSection />
      <BrowseByRoleSection />
      <LiveCandidatesSection candidates={liveCandidates} />
      <HowItWorksSection />
      <WhyStaffVASection />
      <ForCandidatesSection
        totalApproved={totalApproved || 0}
        uniqueCountries={uniqueCountries || 0}
      />
      <FinalCTASection />
      <Footer />
      <QuickMatchButton />
    </main>
  );
}
