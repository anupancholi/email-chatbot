import { NextRequest, NextResponse } from 'next/server';

interface ChatMessage {
  sender: string;
  type: 'text' | 'screenshot';
  content: string;
}
interface EmailIntent {
  email: string;
  password: string;
  to: string;
  subject: string;
  body: string;
}

async function openaiReply(message: string, history: ChatMessage[]) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const sysPrompt = `You are a helpful assistant that can control a web browser, ask clarifying questions, plan steps to help users get things done online. Respond as if you are the brains behind a browser agent. You may proactively ask for missing info needed for a task.`;
    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: sysPrompt },
          ...history.slice(-6).map((msg: ChatMessage) => ({
            role: msg.sender === 'user' ? 'user' : 'assistant',
            content: msg.content,
          })),
          { role: 'user', content: message },
        ],
        max_tokens: 180,
        temperature: 0.7,
      })
    });
    const data = await completion.json();
    const reply = data.choices?.[0]?.message?.content;
    if (!reply) return null;
    return {
      sender: 'agent',
      type: 'text',
      content: reply,
    } satisfies ChatMessage;
  } catch {
    return null;
  }
}

function extractEmailIntent(history: ChatMessage[]): EmailIntent | null {
  const parts: EmailIntent = { email: '', password: '', to: '', subject: '', body: '' };
  for (let i = history.length - 1; i >= 0; --i) {
    const m = history[i];
    if (!parts.email && /[\w.-]+@gmail\.com/.test(m.content)) {
      const res = m.content.match(/[\w.-]+@gmail\.com/);
      if (res) parts.email = res[0];
    }
    if (!parts.password && /password[:=]? ([^\s]+)/i.test(m.content)) {
      const res = m.content.match(/password[:=]? ([^\s]+)/i);
      if (res) parts.password = res[1];
    }
    if (!parts.to && /to[:=]? ([\w.-]+@[\w.-]+)/i.test(m.content)) {
      const res = m.content.match(/to[:=]? ([\w.-]+@[\w.-]+)/i);
      if (res) parts.to = res[1];
    }
    if (!parts.subject && /subject[:=]? "([^"]+)"/i.test(m.content)) {
      const res = m.content.match(/subject[:=]? "([^"]+)"/i);
      if (res) parts.subject = res[1];
    }
    if (!parts.body && /body[:=]? "([^"]+)"/i.test(m.content)) {
      const res = m.content.match(/body[:=]? "([^"]+)"/i);
      if (res) parts.body = res[1];
    }
  }
  const wantsMail = history.some(m => /send (an )?email/i.test(m.content));
  return wantsMail ? parts : null;
}

async function sendEmailWithScreenshots(parts: EmailIntent): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [];
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto('https://mail.google.com/', { waitUntil: 'domcontentloaded' });

    messages.push({ sender: 'agent', type: 'text', content: 'Step 1/5: Opening Gmail and entering your email...' });
    await page.fill('input[type="email"]', parts.email);
    await page.click('button:has-text("Next")');
    await page.waitForTimeout(2000);

    if (await page.locator('iframe[src*="recaptcha"]').count() > 0 ||
      await page.locator('text=/Enter the characters you see/i').count() > 0) {
      const capShot = await page.screenshot({ type: 'png' });
      await browser.close();
      messages.push({ sender: 'agent', type: 'screenshot', content: `data:image/png;base64,${capShot.toString('base64')}` });
      messages.push({ sender: 'agent', type: 'text', content: 'Blocked by Captcha or security check. Please review your Gmail account and ensure automation is allowed.' });
      return messages;
    }

    messages.push({ sender: 'agent', type: 'text', content: 'Step 2/5: Entering your password...' });
    try {
      await page.waitForSelector('input[type="password"]', { timeout: 8000 });
    } catch {
      const errShot = await page.screenshot({ type: 'png' });
      await browser.close();
      messages.push({ sender: 'agent', type: 'screenshot', content: `data:image/png;base64,${errShot.toString('base64')}` });
      messages.push({ sender: 'agent', type: 'text', content: 'Could not find password field (possibly security roadblock or wrong email).' });
      return messages;
    }
    await page.fill('input[type="password"]', parts.password);
    await page.click('button:has-text("Next")');
    await page.waitForTimeout(4000);

    if (await page.locator('input[type="tel"]').count() > 0 ||
      await page.locator('input[type="text"][aria-label*="code"]').count() > 0 ||
      await page.locator('text=/2-step/i').count() > 0 ||
      await page.locator('text=/Check your phone|Verify it/i').count() > 0) {
      const secShot = await page.screenshot({ type: 'png' });
      await browser.close();
      messages.push({ sender: 'agent', type: 'screenshot', content: `data:image/png;base64,${secShot.toString('base64')}` });
      messages.push({ sender: 'agent', type: 'text', content: 'Blocked by extra Gmail security check or 2FA. Please disable these (for test account only) or try again.' });
      return messages;
    }

    await page.waitForTimeout(4000);
    messages.push({ sender: 'agent', type: 'text', content: 'Step 3/5: Successfully logged in! This is your inbox.' });
    const inboxShot = await page.screenshot({ type: 'png' });
    messages.push({ sender: 'agent', type: 'screenshot', content: `data:image/png;base64,${inboxShot.toString('base64')}` });

    messages.push({ sender: 'agent', type: 'text', content: 'Step 4/5: Composing your email...' });
    await page.click('div[role="button"][gh="cm"]');
    await page.waitForTimeout(3000);

    await page.locator('button:has-text("Got it")').click({ timeout: 2000 }).catch(() => { });
    await page.locator('button:has-text("Dismiss")').click({ timeout: 2000 }).catch(() => { });
    await page.locator('button:has-text("Close")').click({ timeout: 2000 }).catch(() => { });

    async function tryFill(locatorStr: string, value: string) {
      const locator = page.locator(locatorStr);
      await locator.waitFor({ state: 'visible', timeout: 15000 });
      for (let i = 0; i < 3; i++) {
        try {
          await locator.click({ timeout: 3000 });
          await page.waitForTimeout(500);
          await locator.fill(value, { timeout: 3000 });
          return true;
        } catch {
          await page.waitForTimeout(1000);
        }
      }
      return false;
    }

    try {
      const success =
        await tryFill('textarea[name="to"]', parts.to) &&
        await tryFill('input[name="subjectbox"]', parts.subject) &&
        await tryFill('div[aria-label="Message Body"]', parts.body);

      if (!success) throw new Error('Could not reliably fill all fields.');

      const composeShot = await page.screenshot({ type: 'png' });
      messages.push({ sender: 'agent', type: 'screenshot', content: `data:image/png;base64,${composeShot.toString('base64')}` });

      messages.push({ sender: 'agent', type: 'text', content: 'Step 5/5: Email is ready! Sending now...' });
      await page.click('div[aria-label*="Send"]');
      await page.waitForTimeout(5000);

      const sentShot = await page.screenshot({ type: 'png' });
      messages.push({ sender: 'agent', type: 'text', content: 'All done! Here is a screenshot after sending:' });
      messages.push({ sender: 'agent', type: 'screenshot', content: `data:image/png;base64,${sentShot.toString('base64')}` });

      await browser.close();
      return messages;
    } catch (err) {
      const composeErrShot = await page.screenshot({ type: 'png' });
      messages.push({ sender: 'agent', type: 'screenshot', content: `data:image/png;base64,${composeErrShot.toString('base64')}` });
      messages.push({ sender: 'agent', type: 'text', content: 'Could not fill one or more compose fields after retries. Gmail may require manual focus or has overlays active.' });
      await browser.close();
      return messages;
    }
  } catch (e) {
    messages.push({ sender: 'agent', type: 'text', content: `Email send failed: ${(e as Error).message || String(e)}` });
    return messages;
  }
}

export async function POST(req: NextRequest) {
  const { message, history } = await req.json();
  if (typeof message !== 'string' || !Array.isArray(history)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
  const hist: ChatMessage[] = history;

  if (message.toLowerCase().includes('screenshot test')) {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto('https://google.com');
    const buffer = await page.screenshot({ type: 'png' });
    await browser.close();
    const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
    const agentReply: ChatMessage = {
      sender: 'agent',
      type: 'screenshot',
      content: dataUrl,
    };
    return NextResponse.json({ reply: agentReply });
  }

  const mailIntent = extractEmailIntent([...hist, { sender: 'user', type: 'text', content: message }]);
  if (mailIntent) {
    const missing = Object.entries(mailIntent).filter(([_, v]) => !v).map(([k]) => k);
    if (missing.length > 0) {
      let ask = 'To send an email, I need:';
      if (missing.includes('email')) ask += '\n- Your Gmail address';
      if (missing.includes('password')) ask += '\n- Your Gmail password (for test account ONLY)';
      if (missing.includes('to')) ask += '\n- Recipient email';
      if (missing.includes('subject')) ask += '\n- Email subject (e.g., subject: "Time off request")';
      if (missing.includes('body')) ask += '\n- Email body (e.g., body: "I would like to request time off ...")';
      return NextResponse.json({ reply: { sender: 'agent', type: 'text', content: ask } satisfies ChatMessage });
    }
    const results = await sendEmailWithScreenshots(mailIntent);
    return NextResponse.json({ replies: results });
  }

  const ai = await openaiReply(message, hist);
  if (ai) return NextResponse.json({ reply: ai });

  return NextResponse.json({
    reply: {
      sender: 'agent',
      type: 'text',
      content: `You said: "${message}" (This is an agent placeholder response.)`,
    },
  });
}