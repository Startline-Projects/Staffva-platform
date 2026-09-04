import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { createClient } from "@supabase/supabase-js";
import { hasCronSecret } from "@/lib/auth";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/contracts/generate-pdf
 *
 * Generates a PDF from the contract HTML, stores in Supabase Storage,
 * and emails both parties the executed contract.
 * Body: { contractId }
 */
export async function POST(request: Request) {
  try {
    // Internal trigger only (called server-side after both parties sign).
    // Previously unauthenticated: anyone could POST a contractId and receive a
    // 1-year signed URL to that executed contract PDF. Fails closed when
    // CRON_SECRET is unset.
    if (!hasCronSecret(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { contractId } = await request.json();
    if (!contractId) {
      return NextResponse.json({ error: "Missing contractId" }, { status: 400 });
    }

    const admin = getAdminClient();

    // Fetch contract
    const { data: contract } = await admin
      .from("engagement_contracts")
      .select("*, clients(full_name, email, company_name), candidates(display_name, email, full_name)")
      .eq("id", contractId)
      .single();

    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    if (contract.status !== "fully_executed") {
      return NextResponse.json({ error: "Contract not fully executed yet" }, { status: 400 });
    }

    // Generate PDF using puppeteer-core + @sparticuz/chromium
    let pdfBuffer: Buffer;
    // Declared outside the try so the finally below can always close it.
    // Previously `browser` was scoped inside the try and closed only on the
    // happy path, so any failure in newPage/setContent/pdf leaked the whole
    // chromium process on a warm lambda until it ran out of memory.
    let browser: Awaited<ReturnType<Awaited<typeof import("puppeteer-core")>["default"]["launch"]>> | null = null;
    try {
      // Dynamic imports for serverless compatibility
      const chromium = await import("@sparticuz/chromium");
      const puppeteer = await import("puppeteer-core");

      browser = await puppeteer.default.launch({
        args: chromium.default.args,
        defaultViewport: { width: 816, height: 1056 },
        executablePath: await chromium.default.executablePath(),
        headless: true,
      });

      const page = await browser.newPage();

      // Wrap contract HTML in a print-friendly page
      const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { margin: 1in; size: letter; }
    body { font-family: Georgia, 'Times New Roman', serif; font-size: 12pt; line-height: 1.6; color: #1C1B1A; }
    h1, h2, h3 { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  </style>
</head>
<body>
${contract.contract_html}

<div style="margin-top: 40px; padding-top: 20px; border-top: 2px solid #1C1B1A;">
  <p style="font-size: 11px; color: #666;">
    <strong>Execution Record</strong><br>
    Client signed: ${new Date(contract.client_signed_at).toLocaleString("en-US", { timeZone: "America/Detroit" })} ET (IP: ${contract.client_signature_ip})<br>
    Contractor signed: ${new Date(contract.candidate_signed_at).toLocaleString("en-US", { timeZone: "America/Detroit" })} ET (IP: ${contract.candidate_signature_ip})<br>
    Contract ID: ${contract.id}<br>
    Generated via StaffVA Platform
  </p>
</div>
</body>
</html>`;

      // `domcontentloaded` rather than `networkidle0`: the contract HTML is
      // self-contained, so waiting for network idle only added latency (and
      // waited on any external reference the markup happened to contain).
      await page.setContent(fullHtml, { waitUntil: "domcontentloaded" });
      const pdf = await page.pdf({ format: "letter", printBackground: true });
      pdfBuffer = Buffer.from(pdf);
    } catch (pdfError) {
      console.error("PDF generation error (puppeteer):", pdfError);
      // Fallback: store HTML as-is without PDF
      return NextResponse.json({
        warning: "PDF generation unavailable in this environment. Contract HTML is stored.",
        contractId,
      });
    } finally {
      // Always release chromium, including on the error path above.
      if (browser) {
        try {
          await browser.close();
        } catch (closeError) {
          console.error("Failed to close chromium:", closeError);
        }
      }
    }

    // Upload PDF to Supabase Storage
    const storagePath = `${contract.engagement_id}/contract.pdf`;
    const { error: uploadError } = await admin.storage
      .from("contracts")
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      return NextResponse.json({ error: "Failed to upload PDF" }, { status: 500 });
    }

    // Get the storage URL
    const { data: urlData } = await admin.storage
      .from("contracts")
      .createSignedUrl(storagePath, 365 * 24 * 60 * 60); // 1 year

    const pdfUrl = urlData?.signedUrl || storagePath;

    // Update contract record with PDF URL
    await admin
      .from("engagement_contracts")
      .update({ contract_pdf_url: pdfUrl })
      .eq("id", contractId);

    // Email both parties the executed contract
    const clientInfo = contract.clients as { full_name: string; email: string; company_name: string | null } | null;
    const candidateInfo = contract.candidates as { display_name: string; email: string; full_name: string } | null;
    const pdfBase64 = pdfBuffer.toString("base64");

    if (process.env.RESEND_API_KEY) {
      const emailHtml = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
        <h2 style="color:#1C1B1A;">Contract Fully Executed</h2>
        <p style="color:#444;font-size:14px;">Both parties have signed the Independent Contractor Agreement. A copy of the executed contract is attached to this email for your records.</p>
        <p style="color:#666;font-size:13px;">The client can now proceed with funding escrow to begin work.</p>
        <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
      </div>`;

      const attachment = {
        filename: "StaffVA_Independent_Contractor_Agreement.pdf",
        content: pdfBase64,
      };

      // Send to client
      if (clientInfo?.email) {
        try {
          await sendEmail({
            from: "StaffVA <notifications@staffva.com>",
            to: clientInfo.email,
            subject: `Executed Contract — ${candidateInfo?.display_name || "Contractor"}`,
            html: emailHtml,
            attachments: [attachment],
          }, { recipientKind: "client", emailType: "contract_executed" });
        } catch { /* silent */ }
      }

      // Send to candidate
      if (candidateInfo?.email) {
        try {
          await sendEmail({
            from: "StaffVA <notifications@staffva.com>",
            to: candidateInfo.email,
            subject: `Executed Contract — ${clientInfo?.company_name || clientInfo?.full_name || "Client"}`,
            html: emailHtml,
            attachments: [attachment],
          }, { recipientKind: "candidate", emailType: "contract_executed" });
        } catch { /* silent */ }
      }
    }

    return NextResponse.json({
      success: true,
      pdfUrl,
      contractId,
    });
  } catch (error) {
    console.error("PDF generation error:", error);
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}
