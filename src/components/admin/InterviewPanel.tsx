"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

interface Interview {
  id: string;
  candidate_id: string;
  interview_number: number;
  status: string;
  requested_at: string;
  scheduled_at: string | null;
  conducted_at: string | null;
  communication_score: number | null;
  demeanor_score: number | null;
  role_knowledge_score: number | null;
  notes_pdf_url: string | null;
}

interface Props {
  candidateId: string;
  candidateName: string;
}

export default function InterviewPanel({ candidateId, candidateName }: Props) {
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const [requestLoading, setRequestLoading] = useState(false);
  const [completionForm, setCompletionForm] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    communicationScore: 3,
    demeanorScore: 3,
    roleKnowledgeScore: 3,
  });
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadInterviews();
  }, [candidateId]);

  async function loadInterviews() {
    setLoading(true);
    const res = await fetch(`/api/admin/interviews?candidateId=${candidateId}`);
    const data = await res.json();
    setInterviews(data.interviews || []);
    setLoading(false);
  }

  async function requestInterview(interviewNumber: number) {
    setRequestLoading(true);
    setMessage("");

    const res = await fetch("/api/admin/interviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "request",
        candidateId,
        interviewNumber,
      }),
    });

    const data = await res.json();
    if (data.error) {
      setMessage(data.error);
    } else {
      await loadInterviews();
      setMessage(`Interview ${interviewNumber} requested`);
    }
    setRequestLoading(false);
  }

  async function updateStatus(interviewId: string, status: string) {
    await fetch("/api/admin/interviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_status",
        interviewId,
        status,
      }),
    });
    await loadInterviews();
  }

  async function completeInterview(interviewId: string) {
    setSaving(true);
    setMessage("");

    let notesPdfPath: string | null = null;

    // Upload PDF if provided
    if (pdfFile) {
      const supabase = createClient();
      const fileName = `${candidateId}/interview-${Date.now()}.pdf`;
      const { error: uploadError } = await supabase.storage
        .from("interview-notes")
        .upload(fileName, pdfFile);

      if (uploadError) {
        setMessage("Failed to upload PDF: " + uploadError.message);
        setSaving(false);
        return;
      }
      notesPdfPath = fileName;
    }

    const res = await fetch("/api/admin/interviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "complete",
        interviewId,
        candidateId,
        communicationScore: formData.communicationScore,
        demeanorScore: formData.demeanorScore,
        roleKnowledgeScore: formData.roleKnowledgeScore,
        notesPdfPath,
      }),
    });

    const data = await res.json();
    if (data.error) {
      setMessage(data.error);
    } else {
      setMessage("Interview completed");
      setCompletionForm(null);
      setPdfFile(null);
      await loadInterviews();
    }
    setSaving(false);
  }

  const interview1 = interviews.find((i) => i.interview_number === 1);

  if (loading) {
    return <p className="text-sm text-text/40">Loading interviews...</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-text">
          Interviews for {candidateName}
        </p>
        <div className="flex gap-2">
          {!interview1 && (
            <button
              onClick={() => requestInterview(1)}
              disabled={requestLoading}
              className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              Schedule Interview 1
            </button>
          )}
        </div>
      </div>

      {message && (
        <p className={`text-xs ${message.includes("error") || message.includes("Failed") ? "text-red-600" : "text-green-600"}`}>
          {message}
        </p>
      )}

      {interviews.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
          <p className="text-sm text-text/40">No interviews scheduled yet</p>
          <p className="text-xs text-text/30 mt-1">Click Schedule Interview 1 to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {interviews.map((interview) => (
            <div
              key={interview.id}
              className="rounded-xl border border-gray-200 bg-white p-5"
            >
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-text text-sm">
                  Interview {interview.interview_number}
                </h4>
                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase ${
                  interview.status === "completed"
                    ? "bg-green-100 text-green-700"
                    : interview.status === "scheduled"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-amber-100 text-amber-700"
                }`}>
                  {interview.status}
                </span>
              </div>

              {interview.status === "completed" ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded bg-gray-50 p-2 text-center">
                      <p className="text-[10px] text-text/40">Communication</p>
                      <p className="text-lg font-bold text-text">{interview.communication_score}/5</p>
                    </div>
                    <div className="rounded bg-gray-50 p-2 text-center">
                      <p className="text-[10px] text-text/40">Demeanor</p>
                      <p className="text-lg font-bold text-text">{interview.demeanor_score}/5</p>
                    </div>
                    <div className="rounded bg-gray-50 p-2 text-center">
                      <p className="text-[10px] text-text/40">Role Knowledge</p>
                      <p className="text-lg font-bold text-text">{interview.role_knowledge_score}/5</p>
                    </div>
                  </div>
                  {interview.conducted_at && (
                    <p className="text-xs text-text/40">
                      Conducted: {new Date(interview.conducted_at).toLocaleDateString()}
                    </p>
                  )}
                  {interview.notes_pdf_url && (
                    <p className="text-xs text-primary">Notes PDF uploaded</p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-text/50">
                    Requested: {new Date(interview.requested_at).toLocaleDateString()}
                  </p>

                  {interview.status === "requested" && (
                    <button
                      onClick={() => updateStatus(interview.id, "scheduled")}
                      className="w-full rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                    >
                      Mark as Scheduled
                    </button>
                  )}

                  {(interview.status === "requested" || interview.status === "scheduled") && (
                    <button
                      onClick={() => {
                        setCompletionForm(interview.id);
                        setFormData({ communicationScore: 3, demeanorScore: 3, roleKnowledgeScore: 3 });
                        setPdfFile(null);
                      }}
                      className="w-full rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700 transition-colors"
                    >
                      Mark as Completed
                    </button>
                  )}
                </div>
              )}

              {/* Completion form */}
              {completionForm === interview.id && (
                <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4 space-y-3">
                  <p className="text-xs font-semibold text-green-800">Complete Interview {interview.interview_number}</p>

                  {[
                    { key: "communicationScore", label: "Communication Clarity" },
                    { key: "demeanorScore", label: "Professional Demeanor" },
                    { key: "roleKnowledgeScore", label: "Role Knowledge" },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <label className="block text-xs font-medium text-text/60 mb-1">
                        {label}: {formData[key as keyof typeof formData]}/5
                      </label>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map((score) => (
                          <button
                            key={score}
                            onClick={() => setFormData((prev) => ({ ...prev, [key]: score }))}
                            className={`flex-1 rounded py-1.5 text-xs font-semibold transition-colors ${
                              formData[key as keyof typeof formData] === score
                                ? "bg-primary text-white"
                                : "bg-white border border-gray-300 text-text/60 hover:border-primary"
                            }`}
                          >
                            {score}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}

                  <div>
                    <label className="block text-xs font-medium text-text/60 mb-1">Interview Notes (PDF)</label>
                    <input
                      type="file"
                      accept=".pdf"
                      onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                      className="w-full text-xs text-text/60 file:mr-3 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary hover:file:bg-primary/20"
                    />
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => setCompletionForm(null)}
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-text/60 hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => completeInterview(interview.id)}
                      disabled={saving}
                      className="flex-1 rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700 transition-colors disabled:opacity-50"
                    >
                      {saving ? "Saving..." : "Save & Publish"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
