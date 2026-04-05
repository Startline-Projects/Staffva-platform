import crypto from "crypto";

const CONTRACT_SIGNING_SECRET = process.env.CONTRACT_SIGNING_SECRET || "staffva-contract-signing-secret-default";

// ─── HMAC Signing Token ───

export function generateSigningToken(contractId: string): string {
  const timestamp = Date.now().toString();
  const payload = `${contractId}:${timestamp}`;
  const hmac = crypto.createHmac("sha256", CONTRACT_SIGNING_SECRET).update(payload).digest("hex");
  return `${timestamp}.${hmac}`;
}

export function verifySigningToken(contractId: string, token: string): boolean {
  try {
    const [timestamp, hmac] = token.split(".");
    if (!timestamp || !hmac) return false;

    // Token expires after 7 days
    const tokenAge = Date.now() - Number(timestamp);
    if (tokenAge > 7 * 24 * 60 * 60 * 1000) return false;

    const expected = crypto.createHmac("sha256", CONTRACT_SIGNING_SECRET).update(`${contractId}:${timestamp}`).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ─── Claude API Contract Generation ───

interface ContractParams {
  clientLegalName: string;
  candidateDisplayName: string;
  roleCategory: string;
  hourlyRate: number;
  hoursPerWeek: number;
  paymentCycle: string;
  contractType: string;
  startDate: string;
}

const SYSTEM_PROMPT = `You are a legal document generator for StaffVA, a professional offshore talent marketplace. Generate a complete Independent Contractor Agreement in clean HTML format. The agreement must include these seven sections: 1 Scope of Work, 2 Compensation and Payment, 3 Term and Termination, 4 Intellectual Property Assignment, 5 Confidentiality, 6 Non-Solicitation, 7 Dispute Resolution. The dispute resolution section must specify that all disputes are resolved through StaffVA's dispute framework as the governing platform. The agreement must classify the candidate as an independent contractor not an employee. Use the provided engagement details to populate all variable fields. Return only the HTML document with no preamble or explanation. Use inline CSS styles for all elements. The document should be professional, clean, and suitable for PDF rendering. Use a serif font for the body text and a clean sans-serif for headings.`;

export async function generateContractHtml(params: ContractParams): Promise<string> {
  const userPrompt = `Generate an Independent Contractor Agreement with the following details:

- Client Legal Name: ${params.clientLegalName}
- Contractor (Candidate) Name: ${params.candidateDisplayName}
- Role/Position: ${params.roleCategory}
- Hourly Rate: $${params.hourlyRate}/hour
- Hours Per Week: ${params.hoursPerWeek}
- Payment Cycle: ${params.paymentCycle}
- Contract Type: ${params.contractType}
- Contract Start Date: ${params.startDate}
- Platform: StaffVA
- Platform Operator: Stafva LLC, Dearborn, Michigan
- Service Fee: Included in the client's total payment, separate from contractor compensation

Generate the complete agreement now.`;

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("ANTHROPIC_API_KEY not set — using fallback contract template");
    return generateFallbackHtml(params);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error("Claude API error:", response.status);
      return generateFallbackHtml(params);
    }

    const data = await response.json();
    const html = data?.content?.[0]?.text || "";

    // Validate it contains the 7 required sections
    const requiredSections = [
      "Scope of Work",
      "Compensation",
      "Term",
      "Intellectual Property",
      "Confidentiality",
      "Non-Solicitation",
      "Dispute Resolution",
    ];

    const missingSections = requiredSections.filter((s) => !html.toLowerCase().includes(s.toLowerCase()));
    if (missingSections.length > 2) {
      console.warn("Claude output missing sections:", missingSections);
      return generateFallbackHtml(params);
    }

    return html;
  } catch (error) {
    console.error("Contract generation error:", error);
    return generateFallbackHtml(params);
  }
}

// ─── Fallback Template ───

function generateFallbackHtml(params: ContractParams): string {
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Georgia, 'Times New Roman', serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #1C1B1A; line-height: 1.7; font-size: 14px;">

<div style="text-align: center; margin-bottom: 40px;">
  <h1 style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 24px; font-weight: 700; margin-bottom: 4px;">INDEPENDENT CONTRACTOR AGREEMENT</h1>
  <p style="color: #666; font-size: 13px;">StaffVA Platform Agreement</p>
  <p style="color: #666; font-size: 13px;">Effective Date: ${params.startDate || today}</p>
</div>

<p>This Independent Contractor Agreement ("Agreement") is entered into by and between:</p>
<p><strong>Client:</strong> ${params.clientLegalName} ("Client")</p>
<p><strong>Contractor:</strong> ${params.candidateDisplayName} ("Contractor")</p>
<p><strong>Platform:</strong> Stafva LLC, Dearborn, Michigan, operating as StaffVA ("Platform")</p>

<hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">

<h2 style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 18px; color: #1C1B1A;">1. Scope of Work</h2>
<p>The Contractor shall provide services to the Client in the capacity of <strong>${params.roleCategory}</strong>. The specific scope of work, deliverables, and responsibilities shall be as mutually agreed upon by the Client and Contractor through the StaffVA platform. The Contractor shall perform all services in a professional and workmanlike manner consistent with industry standards.</p>
<p>The Contractor shall dedicate approximately <strong>${params.hoursPerWeek} hours per week</strong> to performing services under this Agreement, unless otherwise agreed in writing.</p>

<h2 style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 18px; color: #1C1B1A;">2. Compensation and Payment</h2>
<p>The Client agrees to compensate the Contractor at a rate of <strong>$${params.hourlyRate} USD per hour</strong>. Payment shall be processed on a <strong>${params.paymentCycle}</strong> basis through the StaffVA escrow payment system.</p>
<p>All payments are held in escrow by the Platform until release conditions are met. A service fee is included in the Client's total payment and is the sole responsibility of the Client. The Contractor receives 100% of their stated rate.</p>
<p>The Contractor is responsible for all applicable taxes, including but not limited to income taxes, self-employment taxes, and any other withholdings required by their jurisdiction.</p>

<h2 style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 18px; color: #1C1B1A;">3. Term and Termination</h2>
<p>This Agreement is effective as of <strong>${params.startDate || today}</strong> and shall remain in effect for the duration of the <strong>${params.contractType}</strong> engagement, unless terminated earlier in accordance with this section.</p>
<p>Either party may terminate this Agreement with 14 days' written notice delivered through the StaffVA platform. In the event of termination, the Client shall pay the Contractor for all work satisfactorily completed up to the date of termination. Funds held in escrow shall be released in accordance with the Platform's escrow release policies.</p>
<p>The Platform reserves the right to terminate this Agreement immediately if either party violates the Platform's Terms of Service.</p>

<h2 style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 18px; color: #1C1B1A;">4. Intellectual Property Assignment</h2>
<p>All work product, deliverables, inventions, designs, code, documentation, and other materials created by the Contractor in the course of performing services under this Agreement ("Work Product") shall be the sole and exclusive property of the Client.</p>
<p>The Contractor hereby assigns to the Client all right, title, and interest in and to the Work Product, including all intellectual property rights therein. The Contractor agrees to execute any documents and take any actions reasonably requested by the Client to effectuate this assignment.</p>
<p>The Contractor retains no rights to use, reproduce, or distribute the Work Product except as authorized by the Client in writing.</p>

<h2 style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 18px; color: #1C1B1A;">5. Confidentiality</h2>
<p>The Contractor acknowledges that in the course of providing services, the Contractor may have access to confidential and proprietary information of the Client ("Confidential Information"). The Contractor agrees to hold all Confidential Information in strict confidence and not to disclose, use, or permit access to such information except as necessary to perform services under this Agreement.</p>
<p>This obligation of confidentiality shall survive the termination of this Agreement for a period of two (2) years.</p>

<h2 style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 18px; color: #1C1B1A;">6. Non-Solicitation</h2>
<p>During the term of this Agreement and for a period of twelve (12) months following its termination, neither the Client nor the Contractor shall directly solicit or engage each other for services outside of the StaffVA platform, unless expressly authorized by the Platform in writing.</p>
<p>This provision exists to protect the integrity of the StaffVA marketplace and ensure fair compensation for platform services.</p>

<h2 style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 18px; color: #1C1B1A;">7. Dispute Resolution</h2>
<p>Any disputes arising out of or relating to this Agreement shall first be submitted to StaffVA's dispute resolution framework. The Platform shall serve as the initial mediator and governing authority for all disputes between the Client and Contractor.</p>
<p>If the dispute cannot be resolved through the Platform's dispute framework within thirty (30) days, either party may pursue binding arbitration in accordance with the rules of the American Arbitration Association, with the arbitration to take place in Wayne County, Michigan.</p>
<p>The prevailing party in any dispute shall be entitled to recover reasonable attorneys' fees and costs.</p>

<hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">

<h2 style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 18px; color: #1C1B1A;">Independent Contractor Status</h2>
<p>The Contractor is an independent contractor and is not an employee, agent, partner, or joint venturer of the Client or the Platform. The Contractor shall have no authority to bind the Client or the Platform in any manner. Nothing in this Agreement shall be construed to create an employment relationship. The Contractor is solely responsible for the manner and means of performing services, subject to the Client's general direction regarding the results to be achieved.</p>

<div style="margin-top: 40px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px;">
  <div>
    <p style="font-weight: 600; margin-bottom: 4px;">Client:</p>
    <p style="margin: 0;">${params.clientLegalName}</p>
    <div style="border-bottom: 1px solid #ccc; height: 40px; margin-top: 16px;"></div>
    <p style="color: #999; font-size: 12px; margin-top: 4px;">Signature &amp; Date</p>
  </div>
  <div>
    <p style="font-weight: 600; margin-bottom: 4px;">Contractor:</p>
    <p style="margin: 0;">${params.candidateDisplayName}</p>
    <div style="border-bottom: 1px solid #ccc; height: 40px; margin-top: 16px;"></div>
    <p style="color: #999; font-size: 12px; margin-top: 4px;">Signature &amp; Date</p>
  </div>
</div>

<p style="text-align: center; color: #999; font-size: 11px; margin-top: 40px;">
  This agreement is facilitated by StaffVA (Stafva LLC) &bull; Dearborn, Michigan &bull; staffva.com
</p>

</body>
</html>`;
}
