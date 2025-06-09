import lighthouse from 'lighthouse';
import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function runLighthouseForPendingUrls() {
  const { data: queue, error } = await supabase
    .from('lighthouse_queue')
    .select('*')
    .eq('status', 'pending')
    .limit(1);

  if (error) {
    console.error('Error fetching queue:', error.message);
    return;
  }

  for (const item of queue) {
    const url = item.url;
    const id = item.id;

    try {
      await supabase
        .from('lighthouse_queue')
        .update({ status: 'processing', started_at: new Date().toISOString() })
        .eq('id', id);

      const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
      const port = new URL(browser.wsEndpoint()).port;

      const result = await lighthouse(url, {
        port,
        output: 'json',
        logLevel: 'info',
      });

      await browser.close();

      await supabase.from('lighthouse_results').insert([{
        url,
        score: result.lhr.categories.performance.score * 100,
        json: result.report,
        created_at: new Date().toISOString()
      }]);

      await supabase
        .from('lighthouse_queue')
        .update({ status: 'done', finished_at: new Date().toISOString() })
        .eq('id', id);

      console.log(`✅ Finished: ${url}`);
    } catch (err) {
      console.error(`❌ Failed: ${url}`, err.message);

      await supabase
        .from('lighthouse_queue')
        .update({ status: 'failed', finished_at: new Date().toISOString() })
        .eq('id', id);
    }
  }
}

setInterval(runLighthouseForPendingUrls, 10000);
