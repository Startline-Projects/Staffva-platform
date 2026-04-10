import { readFileSync } from "fs";
import { join } from "path";

const floatingButton = `
<a id="floating-cta" href="https://staffva.com/signup/candidate" style="
  position:fixed;bottom:32px;right:32px;z-index:999;
  background:#FE6E3E;color:#fff;font-weight:600;font-family:'DM Sans',sans-serif;
  font-size:16px;text-decoration:none;
  padding:14px 28px;border-radius:100px;
  box-shadow:0 4px 20px rgba(254,110,62,0.35);
  transition:opacity 0.3s ease,transform 0.3s ease;
  opacity:0;pointer-events:none;transform:translateY(16px);
" onmouseover="this.style.background='#FF8D67';this.style.transform='translateY(-2px)'"
   onmouseout="this.style.background='#FE6E3E';if(window.scrollY>100)this.style.transform='translateY(0)'"
>Apply Now →</a>
<style>@media(max-width:768px){#floating-cta{padding:12px 22px!important;font-size:14px!important;}}</style>
<script>
window.addEventListener('scroll',function(){var b=document.getElementById('floating-cta');if(window.scrollY>100){b.style.opacity='1';b.style.pointerEvents='auto';b.style.transform='translateY(0)';}else{b.style.opacity='0';b.style.pointerEvents='none';b.style.transform='translateY(16px)';}});
</script>
`;

const html = readFileSync(join(process.cwd(), "staffva-candidate-landing.html"), "utf-8")
  .replace(
    "<head>",
    '<head>\n<meta name="robots" content="noindex, nofollow">'
  )
  .replace(
    "</body>",
    floatingButton + "</body>"
  );

export async function GET() {
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
