import { Head, Html, Main, NextScript } from 'next/document';

import { BASE_PATH, IS_CLICKHOUSE_BUILD, IS_NOINDEX } from '@/config';
import { ibmPlexMono, inter, roboto, robotoMono } from '@/fonts';

export default function Document() {
  const fontClasses = [
    ibmPlexMono.variable,
    robotoMono.variable,
    inter.variable,
    roboto.variable,
  ].join(' ');

  return (
    <Html lang="en" className={fontClasses}>
      <Head>
        {IS_NOINDEX && <meta name="robots" content="noindex, nofollow" />}
        <script src={`${BASE_PATH}/__ENV.js`} />
        <link rel="icon" href={`${BASE_PATH}/favicons/clickstack/favicon.ico`} sizes="any" />
        <link
          rel="icon"
          type="image/svg+xml"
          href={`${BASE_PATH}/favicons/clickstack/favicon.svg`}
        />
        <link
          rel="icon"
          type="image/png"
          sizes="32x32"
          href={`${BASE_PATH}/favicons/clickstack/favicon-32x32.png`}
        />
        <link
          rel="icon"
          type="image/png"
          sizes="16x16"
          href={`${BASE_PATH}/favicons/clickstack/favicon-16x16.png`}
        />
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href={`${BASE_PATH}/favicons/clickstack/apple-touch-icon.png`}
        />
        <meta name="theme-color" content="#1a1a1a" />
        {!IS_CLICKHOUSE_BUILD && (
          <>
            <script src={`${BASE_PATH}/pyodide/pyodide.js`}></script>
          </>
        )}
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
