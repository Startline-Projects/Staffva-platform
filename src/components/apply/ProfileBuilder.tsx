"use client";

import { useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface ProfileBuilderProps {
  candidateId: string;
  candidateData: {
    full_name: string;
    display_name?: string;
    role_category: string;
    monthly_rate: number;
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
  duration: string;
  description: string;
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
  "Legal",
  "Accounting & Finance",
  "Healthcare",
  "Real Estate",
  "Technology",
  "E-commerce",
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
  const [monthlyRate, setMonthlyRate] = useState(candidateData.monthly_rate || 0);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Step 2 — About
  const [bio, setBio] = useState(candidateData.bio || "");

  // Step 3 — Tools
  const roleTools = TOOLS_BY_ROLE[candidateData.role_category] || TOOLS_BY_ROLE["Admin"];
  const [selectedTools, setSelectedTools] = useState<string[]>(candidateData.tools || []);

  // Step 4 — Work Experience
  const [workEntries, setWorkEntries] = useState<WorkEntry[]>([
    { role_title: "", industry: "", duration: "", description: "" },
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
      const canvas = document.createElement("canvas");
      const size = Math.min(img.width, img.height);
      canvas.width = 400;
      canvas.height = 400;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Center crop to square
      const sx = (img.width - size) / 2;
      const sy = (img.height - size) / 2;
      ctx.drawImage(img, sx, sy, size, size, 0, 0, 400, 400);

      canvas.toBlob((blob) => {
        if (blob) {
          const croppedFile = new File([blob], "profile-photo.jpg", { type: "image/jpeg" });
          setPhotoFile(croppedFile);
          setPhotoPreview(URL.createObjectURL(blob));
        }
        setShowCropper(false);
        setRawImageUrl(null);
      }, "image/jpeg", 0.9);
    };
    img.src = rawImageUrl;
  }

  function cancelCrop() {
    setShowCropper(false);
    setRawImageUrl(null);
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
      { role_title: "", industry: "", duration: "", description: "" },
    ]);
  }

  function removeWorkEntry(index: number) {
    setWorkEntries(workEntries.filter((_, i) => i !== index));
  }

  function updateWorkEntry(index: number, field: keyof WorkEntry, value: string) {
    const updated = [...workEntries];
    updated[index] = { ...updated[index], [field]: value };
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
        if (monthlyRate < 100) {
          setError("Monthly rate must be at least $100");
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
          if (!entry.industry || !entry.duration) {
            setError("Complete all fields for each work experience entry");
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
        monthly_rate: monthlyRate,
        bio,
        tools: selectedTools,
        work_experience: validWorkEntries,
        payout_method: payoutMethod,
        availability_status: availability,
        availability_date:
          availability === "available_by_date" ? availabilityDate : null,
        admin_status: "pending_speaking_review",
        profile_completed_at: new Date().toISOString(),
        interview_consent: interviewConsent,
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
                    <p className="text-xs text-text/50 mb-4">Your photo will be center-cropped to a square.</p>
                    <div className="flex items-center justify-center rounded-lg bg-gray-100 p-4">
                      <div className="relative">
                        <img
                          src={rawImageUrl}
                          alt="Preview"
                          className="max-h-64 max-w-full rounded"
                        />
                        {/* Square crop overlay */}
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="border-2 border-white/80 rounded-full shadow-lg" style={{
                            width: "80%",
                            height: "0",
                            paddingBottom: "80%",
                          }} />
                        </div>
                      </div>
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
                Monthly Rate (USD) <span className="text-red-500">*</span>
              </label>
              <input
                id="rate"
                type="number"
                min={100}
                value={monthlyRate || ""}
                onChange={(e) => setMonthlyRate(parseInt(e.target.value) || 0)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
              />
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
                <div className="grid grid-cols-2 gap-3">
                  <select
                    value={entry.industry}
                    onChange={(e) =>
                      updateWorkEntry(i, "industry", e.target.value)
                    }
                    className="rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                  >
                    <option value="">Industry</option>
                    {INDUSTRIES.map((ind) => (
                      <option key={ind} value={ind}>
                        {ind}
                      </option>
                    ))}
                  </select>
                  <select
                    value={entry.duration}
                    onChange={(e) =>
                      updateWorkEntry(i, "duration", e.target.value)
                    }
                    className="rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                  >
                    <option value="">Duration</option>
                    {DURATIONS.map((dur) => (
                      <option key={dur} value={dur}>
                        {dur}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  type="text"
                  maxLength={120}
                  placeholder="One sentence description (max 120 characters)"
                  value={entry.description}
                  onChange={(e) =>
                    updateWorkEntry(i, "description", e.target.value)
                  }
                  className="block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                />
                <p className="text-right text-xs text-text/40">
                  {entry.description.length}/120
                </p>
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
                Up to 3 items. PDF or image, max 5MB each.
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

            {/* Interview consent */}
            <div className="mt-8 rounded-lg border border-gray-200 bg-gray-50 p-5">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={interviewConsent}
                  onChange={(e) => setInterviewConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span className="text-sm text-text/70 leading-relaxed">
                  By submitting your profile you agree that StaffVA may conduct video interviews and share interview notes and scores with prospective clients as part of our vetting process.
                </span>
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
