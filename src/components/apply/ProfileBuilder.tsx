"use client";

import { useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface ProfileBuilderProps {
  candidateId: string;
  candidateData: {
    full_name: string;
    display_name?: string;
    role_category: string;
    hourly_rate: number;
    bio?: string;
    english_written_tier?: string;
    speaking_level?: string;
    skills?: string[];
    tools?: string[];
  };
  onComplete: () => void;
}

type BuilderStep = 1 | 2 | 3 | 4 | 5 | 6;

interface WorkEntry {
  role_title: string;
  industry: string;
  industry_other?: string;
  duration: string;
  description: string;
  start_date: string;
  end_date: string;
  tools_used: string[];
  skills_gained: string[];
}

interface PortfolioItem {
  file: File | null;
  description: string;
}

const TOOLS_BY_ROLE: Record<string, string[]> = {
  Paralegal: [
    "Clio", "MyCase", "PracticePanther", "LexisNexis", "Westlaw",
    "Microsoft Word", "Adobe Acrobat", "Outlook", "Dropbox", "Zoom",
  ],
  "Legal Assistant": [
    "Clio", "MyCase", "PracticePanther", "LexisNexis", "Westlaw",
    "Microsoft Word", "Adobe Acrobat", "Outlook", "Dropbox", "Zoom",
  ],
  "Bookkeeping/AP": [
    "QuickBooks", "Xero", "FreshBooks", "Bill.com", "Gusto",
    "Excel", "NetSuite", "Sage", "Expensify", "Stripe",
  ],
  Admin: [
    "Google Workspace", "Microsoft 365", "Asana", "Trello", "Notion",
    "Slack", "Zoom", "Calendly", "HubSpot", "Salesforce",
  ],
  VA: [
    "Google Workspace", "Microsoft 365", "Asana", "Trello", "Notion",
    "Slack", "Zoom", "Calendly", "HubSpot", "Salesforce",
  ],
  Scheduling: [
    "Calendly", "Acuity", "Google Calendar", "Outlook", "Mindbody",
    "Jane App", "OpenDental", "Dentrix",
  ],
  "Customer Support": [
    "Zendesk", "Intercom", "Freshdesk", "Gorgias", "HubSpot",
    "Salesforce", "Slack", "LiveChat",
  ],
};

const INDUSTRIES = [
  "Accounting and Finance",
  "Banking and Financial Services",
  "Consulting",
  "Construction and Real Estate",
  "E-Commerce",
  "Education",
  "Government",
  "Healthcare",
  "Hospitality and Tourism",
  "Human Resources",
  "Insurance",
  "Legal Services",
  "Logistics and Supply Chain",
  "Manufacturing",
  "Marketing and Advertising",
  "Media and Entertainment",
  "Non-Profit",
  "Real Estate",
  "Retail",
  "Technology and SaaS",
  "Other",
];

const DURATIONS = [
  "Less than 1 year",
  "1 to 2 years",
  "2 to 5 years",
  "5+ years",
];

export default function ProfileBuilder({
  candidateId,
  candidateData,
  onComplete,
}: ProfileBuilderProps) {
  const [currentStep, setCurrentStep] = useState<BuilderStep>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Step 1 — Photo and Basic Info
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [tagline, setTagline] = useState("");
  const [monthlyRate, setMonthlyRate] = useState(candidateData.hourly_rate || 0);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Step 2 — About
  const [bio, setBio] = useState(candidateData.bio || "");

  // Step 3 — Tools
  const roleTools = TOOLS_BY_ROLE[candidateData.role_category] || TOOLS_BY_ROLE["Admin"];
  const [selectedTools, setSelectedTools] = useState<string[]>(candidateData.tools || []);

  // Step 4 — Work Experience
  const [workEntries, setWorkEntries] = useState<WorkEntry[]>([
    { role_title: "", industry: "", industry_other: "", duration: "", description: "", start_date: "", end_date: "", tools_used: [], skills_gained: [] },
  ]);

  // Step 5 — Portfolio and Resume
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([]);
  const [payoutMethod, setPayoutMethod] = useState("");

  // Step 6 — Availability + Consent
  const [availability, setAvailability] = useState<string>("");
  const [availabilityDate, setAvailabilityDate] = useState("");
  const [interviewConsent, setInterviewConsent] = useState(false);

  const firstName = candidateData.full_name?.split(" ")[0] || "";
  const lastInitial = candidateData.full_name?.split(" ")[1]?.[0] || "";
  const displayName = `${firstName} ${lastInitial}.`;

  const [showCropper, setShowCropper] = useState(false);
  const [rawImageUrl, setRawImageUrl] = useState<string | null>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);
  const [cropOffset, setCropOffset] = useState({ x: 0, y: 0 });
  const [cropZoom, setCropZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const cropImgRef = useRef<HTMLImageElement>(null);

  const handlePhotoChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file (JPG or PNG)");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError("Photo must be under 5MB");
      return;
    }

    const img = new window.Image();
    img.onload = () => {
      if (img.width < 200 || img.height < 200) {
        setError("Photo must be at least 200x200 pixels");
        return;
      }
      setError("");
      setRawImageUrl(URL.createObjectURL(file));
      setShowCropper(true);
    };
    img.src = URL.createObjectURL(file);
  }, []);

  function applyCrop() {
    if (!rawImageUrl) return;

    const img = new window.Image();
    img.onload = () => {
      const outSize = 400; // output pixel size
      const canvas = document.createElement("canvas");
      canvas.width = outSize;
      canvas.height = outSize;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // The crop container is 280x280 CSS pixels.
      // The image is rendered with min-width:100% and min-height:100%,
      // meaning its shorter dimension fills 280px exactly.
      const containerSize = 280;

      // Rendered scale: how many CSS pixels per natural pixel
      const renderedScale = containerSize / Math.min(img.width, img.height);

      // The image's rendered size in CSS pixels (before zoom)
      const renderedW = img.width * renderedScale;
      const renderedH = img.height * renderedScale;

      // With zoom applied, the image is scaled up further
      const zoomedW = renderedW * cropZoom;
      const zoomedH = renderedH * cropZoom;

      // The visible crop area (280x280) maps to this region of the zoomed image.
      // The image center is at (zoomedW/2 + offsetX, zoomedH/2 + offsetY) in CSS coords.
      // The crop window center is at (140, 140).
      // So the crop window's top-left in zoomed-image coords is:
      const cropLeftInZoomed = (zoomedW / 2 + cropOffset.x) - containerSize / 2;
      const cropTopInZoomed = (zoomedH / 2 + cropOffset.y) - containerSize / 2;

      // Convert from zoomed CSS coords to natural image pixels:
      const pixelsPerCSS = 1 / (renderedScale * cropZoom);
      const sx = Math.max(0, cropLeftInZoomed * pixelsPerCSS);
      const sy = Math.max(0, cropTopInZoomed * pixelsPerCSS);
      const sSize = containerSize * pixelsPerCSS;

      // Clamp to image bounds
      const clampedSx = Math.min(sx, Math.max(0, img.width - sSize));
      const clampedSy = Math.min(sy, Math.max(0, img.height - sSize));
      const clampedSize = Math.min(sSize, img.width - clampedSx, img.height - clampedSy);

      // Draw cropped square (no circle clip — let CSS handle rounded display)
      ctx.drawImage(img, clampedSx, clampedSy, clampedSize, clampedSize, 0, 0, outSize, outSize);

      canvas.toBlob((blob) => {
        if (blob) {
          const croppedFile = new File([blob], "profile-photo.jpg", { type: "image/jpeg" });
          setPhotoFile(croppedFile);
          setPhotoPreview(URL.createObjectURL(blob));
        }
        setShowCropper(false);
        setRawImageUrl(null);
        setCropOffset({ x: 0, y: 0 });
        setCropZoom(1);
      }, "image/jpeg", 0.92);
    };
    img.src = rawImageUrl;
  }

  function cancelCrop() {
    setShowCropper(false);
    setRawImageUrl(null);
    setCropOffset({ x: 0, y: 0 });
    setCropZoom(1);
  }

  function handleCropMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - cropOffset.x, y: e.clientY - cropOffset.y });
  }

  function handleCropMouseMove(e: React.MouseEvent) {
    if (!isDragging) return;
    setCropOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  }

  function handleCropMouseUp() {
    setIsDragging(false);
  }

  function handleCropTouchStart(e: React.TouchEvent) {
    const touch = e.touches[0];
    setIsDragging(true);
    setDragStart({ x: touch.clientX - cropOffset.x, y: touch.clientY - cropOffset.y });
  }

  function handleCropTouchMove(e: React.TouchEvent) {
    if (!isDragging) return;
    const touch = e.touches[0];
    setCropOffset({
      x: touch.clientX - dragStart.x,
      y: touch.clientY - dragStart.y,
    });
  }

  function toggleTool(tool: string) {
    setSelectedTools((prev) => {
      if (prev.includes(tool)) {
        return prev.filter((t) => t !== tool);
      }
      if (prev.length >= 8) return prev;
      return [...prev, tool];
    });
  }

  function addWorkEntry() {
    if (workEntries.length >= 3) return;
    setWorkEntries([
      ...workEntries,
      { role_title: "", industry: "", industry_other: "", duration: "", description: "", start_date: "", end_date: "", tools_used: [], skills_gained: [] },
    ]);
  }

  function removeWorkEntry(index: number) {
    setWorkEntries(workEntries.filter((_, i) => i !== index));
  }

  function updateWorkEntry(index: number, field: keyof WorkEntry, value: string | string[]) {
    const updated = [...workEntries];
    updated[index] = { ...updated[index], [field]: value };
    setWorkEntries(updated);
  }

  function addWorkEntryTag(index: number, field: "tools_used" | "skills_gained", tag: string) {
    const updated = [...workEntries];
    const arr = updated[index][field];
    if (arr.length >= 5 || arr.includes(tag)) return;
    updated[index] = { ...updated[index], [field]: [...arr, tag] };
    setWorkEntries(updated);
  }

  function removeWorkEntryTag(index: number, field: "tools_used" | "skills_gained", tag: string) {
    const updated = [...workEntries];
    updated[index] = { ...updated[index], [field]: updated[index][field].filter(t => t !== tag) };
    setWorkEntries(updated);
  }

  function addPortfolioItem() {
    if (portfolioItems.length >= 3) return;
    setPortfolioItems([...portfolioItems, { file: null, description: "" }]);
  }

  function removePortfolioItem(index: number) {
    setPortfolioItems(portfolioItems.filter((_, i) => i !== index));
  }

  function validateStep(): boolean {
    setError("");
    switch (currentStep) {
      case 1:
        if (!photoFile && !photoPreview) {
          setError("Profile photo is required");
          return false;
        }
        if (!tagline.trim()) {
          setError("Tagline is required");
          return false;
        }
        if (monthlyRate < 3) {
          setError("Hourly rate must be at least $3/hr");
          return false;
        }
        return true;
      case 2:
        if (!bio.trim()) {
          setError("Bio is required");
          return false;
        }
        return true;
      case 3:
        if (selectedTools.length === 0) {
          setError("Select at least one tool");
          return false;
        }
        return true;
      case 4: {
        const validEntries = workEntries.filter((e) => e.role_title.trim());
        if (validEntries.length === 0) {
          setError("Add at least one work experience entry");
          return false;
        }
        for (const entry of validEntries) {
          if (!entry.industry || !entry.start_date) {
            setError("Each entry needs a role title, industry, and start date");
            return false;
          }
        }
        return true;
      }
      case 5:
        if (!resumeFile) {
          setError("Resume is required");
          return false;
        }
        if (!payoutMethod) {
          setError("Payout method is required");
          return false;
        }
        return true;
      case 6:
        if (!availability) {
          setError("Select your availability");
          return false;
        }
        if (availability === "available_by_date" && !availabilityDate) {
          setError("Select a date");
          return false;
        }
        return true;
      default:
        return true;
    }
  }

  function nextStep() {
    if (!validateStep()) return;
    setCurrentStep((prev) => Math.min(prev + 1, 6) as BuilderStep);
    setError("");
  }

  function prevStep() {
    setCurrentStep((prev) => Math.max(prev - 1, 1) as BuilderStep);
    setError("");
  }

  async function handleSubmit() {
    if (!validateStep()) return;

    if (!interviewConsent) {
      setError("You must agree to the interview consent to submit your profile.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const supabase = createClient();

      // Upload profile photo
      let photoUrl = "";
      if (photoFile) {
        const ext = photoFile.name.split(".").pop();
        const path = `${candidateId}/photo-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("profile-photos")
          .upload(path, photoFile);

        if (uploadError) throw new Error("Failed to upload photo: " + uploadError.message);

        const { data: urlData } = supabase.storage
          .from("profile-photos")
          .getPublicUrl(path);
        photoUrl = urlData.publicUrl;
      }

      // Upload resume
      let resumeUrl = "";
      if (resumeFile) {
        const path = `${candidateId}/resume-${Date.now()}.pdf`;
        const { error: uploadError } = await supabase.storage
          .from("resumes")
          .upload(path, resumeFile);

        if (uploadError) throw new Error("Failed to upload resume: " + uploadError.message);

        const { data: urlData } = supabase.storage
          .from("resumes")
          .getPublicUrl(path);
        resumeUrl = urlData.publicUrl;
      }

      // Upload portfolio items
      for (let i = 0; i < portfolioItems.length; i++) {
        const item = portfolioItems[i];
        if (!item.file) continue;

        const ext = item.file.name.split(".").pop();
        const path = `${candidateId}/portfolio-${i}-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("portfolio")
          .upload(path, item.file);

        if (uploadError) throw new Error("Failed to upload portfolio item: " + uploadError.message);

        const { data: urlData } = supabase.storage
          .from("portfolio")
          .getPublicUrl(path);

        await supabase.from("portfolio_items").insert({
          candidate_id: candidateId,
          file_url: urlData.publicUrl,
          file_type: item.file.type.includes("pdf") ? "pdf" : "image",
          description: item.description || null,
          display_order: i,
        });
      }

      // Filter valid work entries
      const validWorkEntries = workEntries.filter((e) => e.role_title.trim());

      // Update candidate record
      const updateData: Record<string, unknown> = {
        tagline,
        hourly_rate: monthlyRate,
        bio,
        tools: selectedTools,
        work_experience: validWorkEntries,
        payout_method: payoutMethod,
        availability_status: availability,
        availability_date:
          availability === "available_by_date" ? availabilityDate : null,
        admin_status: "approved",
        profile_completed_at: new Date().toISOString(),
        interview_consent: interviewConsent,
        interview_consent_at: interviewConsent ? new Date().toISOString() : null,
        interview_consent_version: interviewConsent ? "v1.0" : null,
      };

      if (photoUrl) updateData.profile_photo_url = photoUrl;
      if (resumeUrl) updateData.resume_url = resumeUrl;

      const { error: updateError } = await supabase
        .from("candidates")
        .update(updateData)
        .eq("id", candidateId);

      if (updateError) throw new Error("Failed to save profile: " + updateError.message);

      // Notify admin
      try {
        await fetch("/api/candidate/notify-admin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateId }),
        });
      } catch {
        // Non-critical
      }

      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSaving(false);
    }
  }

  const stepLabels = [
    "Photo & Info",
    "About",
    "Tools",
    "Experience",
    "Resume",
    "Availability",
  ];

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-bold text-text">Build Your Profile</h1>
      <p className="mt-1 text-sm text-text/60">
        Complete your profile so clients can find and hire you.
      </p>

      {/* Step indicators */}
      <div className="mt-8 flex items-center gap-1">
        {stepLabels.map((label, i) => (
          <div key={label} className="flex-1">
            <div
              className={`h-2 rounded-full transition-colors ${
                i + 1 <= currentStep ? "bg-primary" : "bg-gray-200"
              }`}
            />
            <p
              className={`mt-1 text-xs ${
                i + 1 === currentStep
                  ? "font-semibold text-primary"
                  : "text-text/40"
              }`}
            >
              {label}
            </p>
          </div>
        ))}
      </div>

      {error && (
        <p className="mt-4 text-sm font-medium text-red-600">{error}</p>
      )}

      <div className="mt-8">
        {/* ───────── STEP 1: Photo & Basic Info ───────── */}
        {currentStep === 1 && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-text">
                Profile Photo <span className="text-red-500">*</span>
              </label>
              <p className="text-xs text-text/50">
                Min 200×200px. JPG or PNG. Max 5MB. Will be cropped to a square.
              </p>
              <div className="mt-3 flex items-center gap-6">
                <div
                  onClick={() => photoInputRef.current?.click()}
                  className="flex h-28 w-28 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-gray-300 bg-gray-50 transition-colors hover:border-primary"
                >
                  {photoPreview ? (
                    <img
                      src={photoPreview}
                      alt="Preview"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="text-center">
                      <svg className="mx-auto h-8 w-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                      </svg>
                      <p className="mt-1 text-[10px] text-gray-400">Upload</p>
                    </div>
                  )}
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-text hover:bg-gray-50"
                  >
                    {photoPreview ? "Change Photo" : "Upload Your Photo"}
                  </button>
                  {photoPreview && (
                    <p className="mt-1 text-xs text-green-600">Photo ready — cropped to square</p>
                  )}
                </div>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={handlePhotoChange}
                  className="hidden"
                />
              </div>

              {/* Cropper modal */}
              {showCropper && rawImageUrl && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={cancelCrop}>
                  <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
                    <h3 className="text-lg font-semibold text-text mb-2">Crop Your Photo</h3>
                    <p className="text-xs text-text/50 mb-4">Drag the image to position it within the circle. Use the slider to zoom.</p>
                    <div className="flex items-center justify-center rounded-lg bg-gray-900 p-4">
                      <div
                        className="relative overflow-hidden select-none"
                        style={{ width: 280, height: 280, cursor: isDragging ? "grabbing" : "grab" }}
                        onMouseDown={handleCropMouseDown}
                        onMouseMove={handleCropMouseMove}
                        onMouseUp={handleCropMouseUp}
                        onMouseLeave={handleCropMouseUp}
                        onTouchStart={handleCropTouchStart}
                        onTouchMove={handleCropTouchMove}
                        onTouchEnd={() => setIsDragging(false)}
                      >
                        <img
                          ref={cropImgRef}
                          src={rawImageUrl}
                          alt="Crop"
                          draggable={false}
                          className="absolute"
                          style={{
                            left: `calc(50% + ${cropOffset.x}px)`,
                            top: `calc(50% + ${cropOffset.y}px)`,
                            transform: `translate(-50%, -50%) scale(${cropZoom})`,
                            minWidth: "100%",
                            minHeight: "100%",
                            maxWidth: "none",
                          }}
                        />
                        {/* Circle overlay mask */}
                        <div className="absolute inset-0 pointer-events-none" style={{
                          boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
                          borderRadius: "50%",
                        }} />
                        <div className="absolute inset-0 pointer-events-none rounded-full border-2 border-white/50" />
                      </div>
                    </div>
                    <div className="mt-4 flex items-center gap-3">
                      <svg className="h-4 w-4 text-text/40" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM13.5 10.5h-6" />
                      </svg>
                      <input
                        type="range"
                        min="1"
                        max="3"
                        step="0.05"
                        value={cropZoom}
                        onChange={(e) => setCropZoom(parseFloat(e.target.value))}
                        className="flex-1 accent-primary"
                      />
                      <svg className="h-4 w-4 text-text/40" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6" />
                      </svg>
                    </div>
                    <div className="mt-4 flex gap-2 justify-end">
                      <button onClick={cancelCrop} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-text hover:bg-gray-50">
                        Cancel
                      </button>
                      <button onClick={applyCrop} className="rounded-lg bg-primary px-6 py-2 text-sm font-semibold text-white hover:bg-primary/90">
                        Crop & Save
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-text">
                Display Name
              </label>
              <p className="mt-1 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-text/70">
                {displayName}
              </p>
              <p className="mt-1 text-xs text-text/40">
                Auto-generated for privacy. Clients see first name + last initial.
              </p>
            </div>

            <div>
              <label htmlFor="tagline" className="block text-sm font-medium text-text">
                Tagline <span className="text-red-500">*</span>
              </label>
              <input
                id="tagline"
                type="text"
                maxLength={80}
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="e.g. Paralegal with 5 years US client experience"
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-text/40">{tagline.length}/80</p>
            </div>

            <div>
              <label htmlFor="rate" className="block text-sm font-medium text-text">
                Hourly Rate (USD) <span className="text-red-500">*</span>
              </label>
              <input
                id="rate"
                type="number"
                min={3}
                value={monthlyRate || ""}
                onChange={(e) => setMonthlyRate(parseInt(e.target.value) || 0)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-gray-400">Minimum $3/hr. Clients see this rate on your profile.</p>
            </div>
          </div>
        )}

        {/* ───────── STEP 2: About ───────── */}
        {currentStep === 2 && (
          <div className="space-y-6">
            <div>
              <label htmlFor="bio" className="block text-sm font-medium text-text">
                About You <span className="text-red-500">*</span>
              </label>
              <textarea
                id="bio"
                maxLength={300}
                rows={5}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell clients about your background and what you bring to the role."
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-text/40">{bio.length}/300</p>
            </div>
          </div>
        )}

        {/* ───────── STEP 3: Tools & Software ───────── */}
        {currentStep === 3 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-text">
                Tools & Software <span className="text-red-500">*</span>
              </h3>
              <p className="text-xs text-text/50">
                Select up to 8 tools you actively use. ({selectedTools.length}/8 selected)
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {roleTools.map((tool) => {
                const selected = selectedTools.includes(tool);
                return (
                  <button
                    key={tool}
                    type="button"
                    onClick={() => toggleTool(tool)}
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                      selected
                        ? "border-primary bg-primary text-white"
                        : "border-gray-300 bg-white text-text hover:border-primary hover:text-primary"
                    } ${
                      !selected && selectedTools.length >= 8
                        ? "cursor-not-allowed opacity-40"
                        : ""
                    }`}
                  >
                    {tool}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ───────── STEP 4: Work Experience ───────── */}
        {currentStep === 4 && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-medium text-text">
                Work Experience <span className="text-red-500">*</span>
              </h3>
              <p className="text-xs text-text/50">Add up to 3 entries.</p>
            </div>
            {workEntries.map((entry, i) => (
              <div
                key={i}
                className="rounded-lg border border-gray-200 bg-white p-5 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-text">
                    Entry {i + 1}
                  </span>
                  {workEntries.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeWorkEntry(i)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  placeholder="Role title (e.g. Senior Paralegal)"
                  value={entry.role_title}
                  onChange={(e) =>
                    updateWorkEntry(i, "role_title", e.target.value)
                  }
                  className="block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                />
                <select
                  value={entry.industry}
                  onChange={(e) => { updateWorkEntry(i, "industry", e.target.value); if (e.target.value !== "Other") updateWorkEntry(i, "industry_other", ""); }}
                  className="block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  <option value="">Select industry</option>
                  {INDUSTRIES.map((ind) => (
                    <option key={ind} value={ind}>{ind}</option>
                  ))}
                </select>
                {entry.industry === "Other" && (
                  <input
                    type="text"
                    value={entry.industry_other || ""}
                    onChange={(e) => updateWorkEntry(i, "industry_other", e.target.value)}
                    placeholder="Type your industry"
                    maxLength={100}
                    className="block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-text/50 mb-1">From</label>
                    <input
                      type="month"
                      value={entry.start_date}
                      onChange={(e) => updateWorkEntry(i, "start_date", e.target.value)}
                      className="block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text/50 mb-1">To</label>
                    <input
                      type="month"
                      value={entry.end_date}
                      onChange={(e) => updateWorkEntry(i, "end_date", e.target.value)}
                      placeholder="Present"
                      className="block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                    <label className="mt-1 flex items-center gap-1.5 text-xs text-text/50">
                      <input
                        type="checkbox"
                        checked={entry.end_date === "present"}
                        onChange={(e) => updateWorkEntry(i, "end_date", e.target.checked ? "present" : "")}
                        className="accent-primary"
                      />
                      Currently working here
                    </label>
                  </div>
                </div>
                <input
                  type="text"
                  maxLength={120}
                  placeholder="One sentence description (max 120 characters)"
                  value={entry.description}
                  onChange={(e) => updateWorkEntry(i, "description", e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                />
                <p className="text-right text-xs text-text/40">{entry.description.length}/120</p>

                {/* Tools Used */}
                <div>
                  <label className="block text-xs font-medium text-text/70 mb-1">Tools used in this role (up to 5)</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {entry.tools_used.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
                        {t}
                        <button type="button" onClick={() => removeWorkEntryTag(i, "tools_used", t)} className="text-primary/60 hover:text-primary">×</button>
                      </span>
                    ))}
                  </div>
                  <input
                    type="text"
                    placeholder="Type a tool and press Enter"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        const val = (e.target as HTMLInputElement).value.trim().replace(",", "");
                        if (val) { addWorkEntryTag(i, "tools_used", val); (e.target as HTMLInputElement).value = ""; }
                      }
                    }}
                    className="block w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </div>

                {/* Skills Gained */}
                <div>
                  <label className="block text-xs font-medium text-text/70 mb-1">Skills gained (up to 5)</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {entry.skills_gained.map((s) => (
                      <span key={s} className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs text-green-700">
                        {s}
                        <button type="button" onClick={() => removeWorkEntryTag(i, "skills_gained", s)} className="text-green-500 hover:text-green-700">×</button>
                      </span>
                    ))}
                  </div>
                  <input
                    type="text"
                    placeholder="Type a skill and press Enter"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        const val = (e.target as HTMLInputElement).value.trim().replace(",", "");
                        if (val) { addWorkEntryTag(i, "skills_gained", val); (e.target as HTMLInputElement).value = ""; }
                      }
                    }}
                    className="block w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
            ))}
            {workEntries.length < 3 && (
              <button
                type="button"
                onClick={addWorkEntry}
                className="w-full rounded-lg border-2 border-dashed border-gray-300 py-3 text-sm font-medium text-text/50 hover:border-primary hover:text-primary transition-colors"
              >
                + Add Work Experience
              </button>
            )}
          </div>
        )}

        {/* ───────── STEP 5: Portfolio & Resume ───────── */}
        {currentStep === 5 && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-text">
                Resume <span className="text-red-500">*</span>
              </label>
              <p className="text-xs text-text/50">PDF only. Max 10MB.</p>
              <input
                type="file"
                accept=".pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file && file.size > 10 * 1024 * 1024) {
                    setError("Resume must be under 10MB");
                    return;
                  }
                  setResumeFile(file || null);
                  setError("");
                }}
                className="mt-2 block w-full text-sm text-text/70 file:mr-4 file:rounded-lg file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary hover:file:bg-primary/20"
              />
              {resumeFile && (
                <p className="mt-1 text-xs text-green-600">
                  ✓ {resumeFile.name}
                </p>
              )}
            </div>

            <div>
              <h3 className="text-sm font-medium text-text">
                Portfolio Items{" "}
                <span className="text-text/40 font-normal">(optional)</span>
              </h3>
              <p className="text-xs text-text/50">
                Up to 3 items. PDF or image, max 5MB each. Examples: a cover letter, work sample, certificate, or project screenshot.
              </p>
              {portfolioItems.map((item, i) => (
                <div
                  key={i}
                  className="mt-3 flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4"
                >
                  <div className="flex-1 space-y-2">
                    <input
                      type="file"
                      accept=".pdf,image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file && file.size > 5 * 1024 * 1024) {
                          setError("Portfolio file must be under 5MB");
                          return;
                        }
                        const updated = [...portfolioItems];
                        updated[i] = { ...updated[i], file: file || null };
                        setPortfolioItems(updated);
                        setError("");
                      }}
                      className="block w-full text-sm text-text/70"
                    />
                    <input
                      type="text"
                      maxLength={100}
                      placeholder="One-line description"
                      value={item.description}
                      onChange={(e) => {
                        const updated = [...portfolioItems];
                        updated[i] = {
                          ...updated[i],
                          description: e.target.value,
                        };
                        setPortfolioItems(updated);
                      }}
                      className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removePortfolioItem(i)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
              ))}
              {portfolioItems.length < 3 && (
                <button
                  type="button"
                  onClick={addPortfolioItem}
                  className="mt-3 w-full rounded-lg border-2 border-dashed border-gray-300 py-3 text-sm font-medium text-text/50 hover:border-primary hover:text-primary transition-colors"
                >
                  + Add Portfolio Item
                </button>
              )}
            </div>

            <div>
              <label htmlFor="payout" className="block text-sm font-medium text-text">
                Payout Method <span className="text-red-500">*</span>
              </label>
              <select
                id="payout"
                value={payoutMethod}
                onChange={(e) => setPayoutMethod(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">Select payout method</option>
                <option value="payoneer">Payoneer</option>
                <option value="wise">Wise</option>
                <option value="bank_transfer">Local Bank Transfer</option>
              </select>
            </div>
          </div>
        )}

        {/* ───────── STEP 6: Availability ───────── */}
        {currentStep === 6 && (
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-text">
              When can you start? <span className="text-red-500">*</span>
            </h3>
            <div className="grid gap-4">
              <button
                type="button"
                onClick={() => setAvailability("available_now")}
                className={`rounded-xl border-2 p-5 text-left transition-colors ${
                  availability === "available_now"
                    ? "border-green-500 bg-green-50"
                    : "border-gray-200 bg-white hover:border-green-300"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">🟢</span>
                  <div>
                    <p className="font-semibold text-text">Available Now</p>
                    <p className="text-xs text-text/50">
                      Ready to start immediately
                    </p>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setAvailability("available_by_date")}
                className={`rounded-xl border-2 p-5 text-left transition-colors ${
                  availability === "available_by_date"
                    ? "border-yellow-500 bg-yellow-50"
                    : "border-gray-200 bg-white hover:border-yellow-300"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">🟡</span>
                  <div>
                    <p className="font-semibold text-text">
                      Available From a Specific Date
                    </p>
                    <p className="text-xs text-text/50">
                      I can start on a future date
                    </p>
                  </div>
                </div>
              </button>
              {availability === "available_by_date" && (
                <input
                  type="date"
                  value={availabilityDate}
                  onChange={(e) => setAvailabilityDate(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                  className="ml-12 w-auto rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                />
              )}

              <button
                type="button"
                onClick={() => setAvailability("not_available")}
                className={`rounded-xl border-2 p-5 text-left transition-colors ${
                  availability === "not_available"
                    ? "border-gray-500 bg-gray-50"
                    : "border-gray-200 bg-white hover:border-gray-400"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">⚪</span>
                  <div>
                    <p className="font-semibold text-text">
                      Not Available Currently
                    </p>
                    <p className="text-xs text-text/50">
                      I&apos;m not ready to take on work right now
                    </p>
                  </div>
                </div>
              </button>
            </div>

            {/* Voice recording consent */}
            <div className="mt-8 rounded-lg border border-gray-200 bg-gray-50 p-5">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={interviewConsent}
                  onChange={(e) => setInterviewConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#FE6E3E] focus:ring-[#FE6E3E]"
                />
                <div>
                  <span className="text-sm text-[#1C1B1A]/70 leading-relaxed">
                    I consent to my voice recordings being made available to registered clients on StaffVA for the purpose of hiring evaluation. I understand my recordings will be visible to logged-in clients browsing my profile.
                  </span>
                  <p className="mt-2 text-xs text-gray-400 italic">
                    Your voice is your strongest profile feature. Clients hear you before they hire you — this is what sets StaffVA apart.
                  </p>
                </div>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Navigation buttons */}
      <div className="mt-10 flex items-center justify-between">
        {currentStep > 1 ? (
          <button
            type="button"
            onClick={prevStep}
            className="rounded-lg border border-gray-300 px-6 py-3 text-sm font-medium text-text hover:bg-gray-50 transition-colors"
          >
            Back
          </button>
        ) : (
          <div />
        )}

        {currentStep < 6 ? (
          <button
            type="button"
            onClick={nextStep}
            className="rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-white hover:bg-orange-600 transition-colors"
          >
            Continue
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || (currentStep === 6 && !interviewConsent)}
            className="rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-white hover:bg-orange-600 transition-colors disabled:opacity-50"
          >
            {saving ? "Submitting..." : "Submit Profile"}
          </button>
        )}
      </div>
    </div>
  );
}
