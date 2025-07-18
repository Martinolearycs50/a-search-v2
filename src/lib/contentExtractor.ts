import * as cheerio from 'cheerio';
import type { PageType } from './types';

export interface ExtractedContent {
  // Core content identification
  primaryTopic: string;
  detectedTopics: string[];
  businessType: 'payment' | 'ecommerce' | 'blog' | 'news' | 'documentation' | 'corporate' | 'educational' | 'other';
  pageType: PageType;
  
  // Extracted content samples
  contentSamples: {
    title: string;
    headings: Array<{ level: number; text: string; content?: string }>;
    paragraphs: string[];
    lists: Array<{ type: 'ul' | 'ol'; items: string[] }>;
    statistics: string[];
    comparisons: string[];
  };
  
  // Content patterns detected
  detectedFeatures: {
    hasPaymentForms: boolean;
    hasProductListings: boolean;
    hasAPIDocumentation: boolean;
    hasPricingInfo: boolean;
    hasBlogPosts: boolean;
    hasTutorials: boolean;
    hasComparisons: boolean;
    hasQuestions: boolean;
  };
  
  // Key terms and phrases
  keyTerms: string[];
  productNames: string[];
  technicalTerms: string[];
  
  // Metadata
  wordCount: number;
  language: string;
}

/**
 * Extracts comprehensive content information from HTML for generating
 * content-aware recommendations
 */
export class ContentExtractor {
  private $: cheerio.CheerioAPI;
  private contentText: string;
  private pageUrl?: string;
  
  constructor(html: string, pageUrl?: string) {
    try {
      this.$ = cheerio.load(html || '');
      this.pageUrl = pageUrl;
      
      // Extract text with proper spacing
      const mainContent = this.$('main, article, [role="main"], .content, #content');
      
      if (mainContent.length > 0) {
        this.contentText = this.extractTextWithSpacing(mainContent);
      } else {
        this.contentText = this.extractTextWithSpacing(this.$('body'));
      }
      
      // Limit content size to prevent memory issues
      if (this.contentText.length > 100000) {
        console.warn('[ContentExtractor] Content too large, truncating to 100KB');
        this.contentText = this.contentText.substring(0, 100000);
      }
    } catch (error) {
      console.error('[ContentExtractor] Failed to initialize:', error);
      this.$ = cheerio.load('<html><body></body></html>');
      this.contentText = '';
    }
  }
  
  /**
   * Extract text from elements with proper spacing
   */
  private extractTextWithSpacing(elements: cheerio.Cheerio<any>): string {
    const textParts: string[] = [];
    
    // Define elements and text patterns to skip
    const skipPatterns = [
      /^(logo|icon|image|img|svg|close|open|toggle|menu|nav|navigation)$/i,
      /^(button|btn|link|click here|tap here|swipe)$/i,
      /^(loading|spinner|loader|processing)$/i,
      /^[<>×✕✖✗]$/, // Close button symbols
      /^(show|hide|expand|collapse|more|less)$/i,
    ];
    
    // Skip common navigation class/id patterns
    const skipSelectors = [
      '.nav', '.navigation', '.menu', '.header', '.footer',
      '[class*="logo"]', '[class*="icon"]', '[class*="button"]',
      '[id*="logo"]', '[id*="icon"]', '[id*="button"]',
      '.mobile-nav', '.mobile-menu', '#mobile-nav', '#mobile-menu',
      '[aria-label*="navigation"]', '[role="navigation"]',
      'button', 'nav', 'header', 'footer'
    ];
    
    // Remove elements we want to skip
    const skipElements = elements.find(skipSelectors.join(', '));
    skipElements.remove();
    
    // Process text nodes with proper spacing
    const processNode = (node: any) => {
      if (node.type === 'text') {
        const text = node.data.trim();
        if (text && text.length > 1) {
          // Check if text matches skip patterns
          const shouldSkip = skipPatterns.some(pattern => pattern.test(text));
          if (!shouldSkip) {
            textParts.push(text);
          }
        }
      } else if (node.children) {
        // For block-level elements, add spacing
        const blockElements = ['p', 'div', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'blockquote', 'pre'];
        
        node.children.forEach((child: any) => {
          processNode(child);
          
          // Add space after block elements
          if (child.type === 'tag' && blockElements.includes(child.name)) {
            textParts.push(' ');
          }
        });
      }
    };
    
    elements.each((_, el) => {
      processNode(el);
    });
    
    // Join with spaces and clean up excessive whitespace
    return textParts
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,!?;:])/g, '$1')
      .trim();
  }

  /**
   * Detect if the page is an error or blocked page
   */
  private isErrorPage(): boolean {
    const errorIndicators = [
      // Common error messages
      'suite of APIs powering online payment processing',
      'Accept payments and scale faster',
      'error', '404', '403', '500', '502', '503',
      'page not found', 'access denied', 'forbidden',
      'blocked', 'rate limit', 'too many requests',
      // Bot detection messages
      'captcha', 'verify you are human', 'robot check',
      'cloudflare', 'security check',
      // Empty content indicators
      'javascript is required', 'enable javascript',
      'browser not supported'
    ];
    
    const lowerContent = this.contentText.toLowerCase();
    const lowerTitle = this.extractTitle().toLowerCase();
    
    // Check for error indicators in content
    for (const indicator of errorIndicators) {
      if (lowerContent.includes(indicator) || lowerTitle.includes(indicator)) {
        // Additional check: if the page has very little content and contains error words
        if (this.contentText.length < 500 || this.$('main, article').text().length < 100) {
          console.log(`[ContentExtractor] Detected error/blocked page: contains "${indicator}"`);
          return true;
        }
      }
    }
    
    // Check for Stripe-specific API description page
    if (lowerContent.includes('stripe is a suite of apis') && 
        lowerContent.includes('powering online payment') &&
        this.$('body').text().length < 1000) {
      console.log('[ContentExtractor] Detected Stripe API error page');
      return true;
    }
    
    return false;
  }

  /**
   * Extract all content information from the page
   */
  extract(): ExtractedContent {
    try {
      // Check if this is an error page first
      if (this.isErrorPage()) {
        console.log('[ContentExtractor] Error page detected, returning minimal content');
        return {
          primaryTopic: 'Error Page',
          detectedTopics: ['error'],
          businessType: 'other',
          pageType: 'general',
          contentSamples: {
            title: this.extractTitle() || 'Error',
            headings: [],
            paragraphs: ['This page appears to be blocked or returning an error.'],
            lists: [],
            statistics: [],
            comparisons: [],
          },
          detectedFeatures: {
            hasPaymentForms: false,
            hasProductListings: false,
            hasAPIDocumentation: false,
            hasPricingInfo: false,
            hasBlogPosts: false,
            hasTutorials: false,
            hasComparisons: false,
            hasQuestions: false,
          },
          keyTerms: [],
          productNames: [],
          technicalTerms: [],
          wordCount: 0,
          language: 'en',
        };
      }

      const title = this.extractTitle();
      const headings = this.extractHeadings();
      const topics = this.detectTopics(title, headings);
      const businessType = this.detectBusinessType(topics);
      const pageType = this.detectPageType();
      
      return {
        primaryTopic: topics.primary,
        detectedTopics: topics.all,
        businessType,
        pageType,
        contentSamples: {
          title,
          headings,
          paragraphs: this.extractParagraphs(),
          lists: this.extractLists(),
          statistics: this.extractStatistics(),
          comparisons: this.extractComparisons(),
        },
        detectedFeatures: this.detectFeatures(),
        keyTerms: this.extractKeyTerms(),
        productNames: this.extractProductNames(),
        technicalTerms: this.extractTechnicalTerms(),
        wordCount: this.contentText.split(/\s+/).filter(w => w.length > 0).length,
        language: this.$('html').attr('lang')?.split('-')[0] || 'en',
      };
    } catch (error) {
      console.error('[ContentExtractor] Extract failed, returning defaults:', error);
      return this.getDefaultExtractedContent();
    }
  }
  
  private getDefaultExtractedContent(): ExtractedContent {
    return {
      primaryTopic: 'general content',
      detectedTopics: [],
      businessType: 'other',
      pageType: 'general',
      contentSamples: {
        title: '',
        headings: [],
        paragraphs: [],
        lists: [],
        statistics: [],
        comparisons: [],
      },
      detectedFeatures: {
        hasPaymentForms: false,
        hasProductListings: false,
        hasAPIDocumentation: false,
        hasPricingInfo: false,
        hasBlogPosts: false,
        hasTutorials: false,
        hasComparisons: false,
        hasQuestions: false,
      },
      keyTerms: [],
      productNames: [],
      technicalTerms: [],
      wordCount: 0,
      language: 'en',
    };
  }
  
  private extractTitle(): string {
    try {
      let title = this.$('title').text() || 
                  this.$('meta[property="og:title"]').attr('content') || 
                  this.$('h1').first().text() || 
                  '';
      
      // Clean up title by removing common UI/navigation text patterns
      // Look for the actual title part (usually before the first occurrence of these patterns)
      const uiPatterns = [
        'logo', 'icon', 'navigation', 'menu', 'close', 'open', 
        'toggle', 'button', 'click', 'tap', 'swipe'
      ];
      
      // Find the first occurrence of any UI pattern
      let cutoffIndex = title.length;
      for (const pattern of uiPatterns) {
        const index = title.toLowerCase().indexOf(pattern);
        if (index > 0 && index < cutoffIndex) {
          cutoffIndex = index;
        }
      }
      
      // If we found UI patterns, truncate before them
      if (cutoffIndex < title.length) {
        title = title.substring(0, cutoffIndex).trim();
      }
      
      // Also handle common title separators
      const separators = ['|', '-', '–', '—', '::'];
      for (const sep of separators) {
        const parts = title.split(sep);
        if (parts.length > 1 && parts[0].trim().length > 5) {
          // Keep only the first meaningful part
          title = parts[0].trim();
          break;
        }
      }
      
      return title;
    } catch (error) {
      console.warn('[ContentExtractor] extractTitle failed:', error);
      return '';
    }
  }
  
  private extractHeadings(): Array<{ level: number; text: string; content?: string }> {
    try {
      const headings: Array<{ level: number; text: string; content?: string }> = [];
      
      this.$('h1, h2, h3, h4').each((_, el) => {
        try {
          const $heading = this.$(el);
          const level = parseInt(el.tagName.substring(1));
          const text = $heading.text().trim();
          
          if (text) {
            // Get content after heading (first 200 chars)
            let contentAfter = '';
            let $next = $heading.next();
            let iterations = 0;
            while ($next.length && !$next.is('h1, h2, h3, h4') && contentAfter.length < 200 && iterations < 10) {
              contentAfter += ' ' + $next.text();
              $next = $next.next();
              iterations++;
            }
            
            headings.push({
              level,
              text,
              content: contentAfter.trim().substring(0, 200)
            });
          }
        } catch (innerError) {
          console.warn('[ContentExtractor] Error processing heading:', innerError);
        }
      });
      
      return headings.slice(0, 20); // Limit to first 20 headings
    } catch (error) {
      console.warn('[ContentExtractor] extractHeadings failed:', error);
      return [];
    }
  }
  
  private extractParagraphs(): string[] {
    try {
      const paragraphs: string[] = [];
      
      this.$('p').each((_, el) => {
        try {
          const text = this.$(el).text().trim();
          if (text && text.length > 50) { // Only substantial paragraphs
            paragraphs.push(text);
          }
        } catch (innerError) {
          console.warn('[ContentExtractor] Error processing paragraph:', innerError);
        }
      });
      
      return paragraphs.slice(0, 10); // Limit to first 10 paragraphs
    } catch (error) {
      console.warn('[ContentExtractor] extractParagraphs failed:', error);
      return [];
    }
  }
  
  private extractLists(): Array<{ type: 'ul' | 'ol'; items: string[] }> {
    try {
      const lists: Array<{ type: 'ul' | 'ol'; items: string[] }> = [];
      
      this.$('ul, ol').each((_, el) => {
        try {
          const $list = this.$(el);
          const type = el.tagName.toLowerCase() as 'ul' | 'ol';
          const items: string[] = [];
          
          $list.find('> li').each((_, li) => {
            try {
              const text = this.$(li).text().trim();
              if (text) {
                items.push(text.substring(0, 100)); // Limit item length
              }
            } catch (innerError) {
              console.warn('[ContentExtractor] Error processing list item:', innerError);
            }
          });
          
          if (items.length > 0) {
            lists.push({ type, items: items.slice(0, 10) }); // Limit items
          }
        } catch (innerError) {
          console.warn('[ContentExtractor] Error processing list:', innerError);
        }
      });
      
      return lists.slice(0, 5); // Limit to first 5 lists
    } catch (error) {
      console.warn('[ContentExtractor] extractLists failed:', error);
      return [];
    }
  }
  
  private extractStatistics(): string[] {
    try {
      const stats: string[] = [];
      const text = this.contentText || '';
      
      // Safely extract percentages with context
      try {
        const percentages = text.match(/(\w+\s+)?(\d+(?:\.\d+)?%)/g) || [];
        stats.push(...percentages.slice(0, 5));
      } catch (e) {
        console.warn('[ContentExtractor] Failed to extract percentages:', e);
      }
      
      // Safely extract numbers with units
      try {
        const measurements = text.match(/\d+(?:,\d+)*(?:\.\d+)?\s*(?:million|billion|thousand|users|customers|transactions|requests|visitors|downloads|installs)/gi) || [];
        stats.push(...measurements.slice(0, 5));
      } catch (e) {
        console.warn('[ContentExtractor] Failed to extract measurements:', e);
      }
      
      // Safely extract monetary values
      try {
        const money = text.match(/[$€£¥]\d+(?:,\d+)*(?:\.\d+)?(?:\s*(?:million|billion|k|K|M|B))?/g) || [];
        stats.push(...money.slice(0, 5));
      } catch (e) {
        console.warn('[ContentExtractor] Failed to extract monetary values:', e);
      }
      
      return Array.from(new Set(stats)).slice(0, 10); // Unique stats, max 10
    } catch (error) {
      console.warn('[ContentExtractor] extractStatistics failed:', error);
      return [];
    }
  }
  
  private extractComparisons(): string[] {
    try {
      const comparisons: string[] = [];
      
      // Look for comparison patterns in headings
      this.$('h1, h2, h3, h4').each((_, el) => {
        try {
          const text = this.$(el).text();
          if (text && text.match(/\b(vs|versus|compared to|comparison|differences?|better than|alternative)\b/i)) {
            comparisons.push(text);
          }
        } catch (innerError) {
          console.warn('[ContentExtractor] Error processing comparison heading:', innerError);
        }
      });
      
      // Look for comparison phrases in content
      try {
        const comparisonPhrases = this.contentText.match(/\b\w+\s+(?:vs|versus|compared to)\s+\w+\b/gi) || [];
        comparisons.push(...comparisonPhrases);
      } catch (e) {
        console.warn('[ContentExtractor] Failed to extract comparison phrases:', e);
      }
      
      return Array.from(new Set(comparisons)).slice(0, 5);
    } catch (error) {
      console.warn('[ContentExtractor] extractComparisons failed:', error);
      return [];
    }
  }
  
  private detectTopics(title: string, headings: Array<{ text: string }>): { primary: string; all: string[] } {
    try {
      const allText = (title || '') + ' ' + headings.map(h => h.text || '').join(' ');
      const words = allText.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      
      // Count word frequency
      const wordFreq = new Map<string, number>();
      words.forEach(word => {
        try {
          // Skip common words
          if (!this.isCommonWord(word)) {
            wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
          }
        } catch (e) {
          console.warn('[ContentExtractor] Error processing word:', e);
        }
      });
      
      // Find most frequent meaningful words
      const topWords = Array.from(wordFreq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([word]) => word);
      
      // Extract phrases from title
      const titleWords = (title || '').split(/[\s\-–—:|]+/).filter(w => w.length > 2);
      const primaryTopic = titleWords.slice(0, 3).join(' ') || topWords[0] || 'general content';
      
      // Build topic list
      const topics = [primaryTopic];
      
      // Add domain-specific topics
      try {
        if (allText.match(/\b(payment|transaction|checkout|billing|invoice)/i)) {
          topics.push('payment processing');
        }
        if (allText.match(/\b(product|shop|cart|buy|price|sale)/i)) {
          topics.push('e-commerce');
        }
        if (allText.match(/\b(api|endpoint|integration|sdk|documentation)/i)) {
          topics.push('technical documentation');
        }
        if (allText.match(/\b(blog|article|post|story|news)/i)) {
          topics.push('content publishing');
        }
      } catch (e) {
        console.warn('[ContentExtractor] Error detecting topic patterns:', e);
      }
      
      return {
        primary: primaryTopic,
        all: Array.from(new Set(topics)).slice(0, 5)
      };
    } catch (error) {
      console.warn('[ContentExtractor] detectTopics failed:', error);
      return {
        primary: 'general content',
        all: ['general content']
      };
    }
  }
  
  private detectBusinessType(topics: { all: string[] }): ExtractedContent['businessType'] {
    try {
      const allTopics = (topics?.all || []).join(' ').toLowerCase();
      const bodyText = (this.contentText || '').toLowerCase();
      
      // Check for specific business indicators
      if (bodyText.includes('payment') || bodyText.includes('transaction') || bodyText.includes('merchant')) {
        return 'payment';
      }
      
      try {
        if (this.$('.product, .price, .add-to-cart, .shop').length > 0 || bodyText.includes('buy now')) {
          return 'ecommerce';
        }
        if (this.$('.blog-post, .article-date, .author').length > 0 || allTopics.includes('blog')) {
          return 'blog';
        }
        if (this.$('.news-item, .press-release').length > 0 || allTopics.includes('news')) {
          return 'news';
        }
        if (this.$('code, pre').length > 10) {
          return 'documentation';
        }
      } catch (e) {
        console.warn('[ContentExtractor] Error checking DOM elements:', e);
      }
      
      if (bodyText.includes('api') || bodyText.includes('documentation')) {
        return 'documentation';
      }
      if (bodyText.includes('about us') || bodyText.includes('our services') || bodyText.includes('company')) {
        return 'corporate';
      }
      if (bodyText.includes('course') || bodyText.includes('tutorial') || bodyText.includes('learn')) {
        return 'educational';
      }
      
      return 'other';
    } catch (error) {
      console.warn('[ContentExtractor] detectBusinessType failed:', error);
      return 'other';
    }
  }
  
  private detectFeatures(): ExtractedContent['detectedFeatures'] {
    try {
      const $ = this.$;
      const text = (this.contentText || '').toLowerCase();
      
      const features: ExtractedContent['detectedFeatures'] = {
        hasPaymentForms: false,
        hasProductListings: false,
        hasAPIDocumentation: false,
        hasPricingInfo: false,
        hasBlogPosts: false,
        hasTutorials: false,
        hasComparisons: false,
        hasQuestions: false,
      };
      
      try {
        features.hasPaymentForms = $('form').filter((_, el) => {
          try {
            const formText = $(el).text().toLowerCase();
            return formText.includes('payment') || formText.includes('card') || formText.includes('checkout');
          } catch (e) {
            return false;
          }
        }).length > 0;
      } catch (e) {
        console.warn('[ContentExtractor] Error detecting payment forms:', e);
      }
      
      try {
        features.hasProductListings = $('.product, .item, .listing').length > 0 || text.includes('add to cart');
      } catch (e) {
        features.hasProductListings = text.includes('add to cart');
      }
      
      try {
        features.hasAPIDocumentation = $('code, pre').length > 5 || text.includes('endpoint') || text.includes('api');
      } catch (e) {
        features.hasAPIDocumentation = text.includes('endpoint') || text.includes('api');
      }
      
      try {
        features.hasPricingInfo = $('.price, .pricing').length > 0 || text.match(/[$€£¥]\d+/) !== null;
      } catch (e) {
        features.hasPricingInfo = text.match(/[$€£¥]\d+/) !== null;
      }
      
      try {
        features.hasBlogPosts = $('.post, .article, .blog-entry').length > 0 || $('article').length > 0;
      } catch (e) {
        console.warn('[ContentExtractor] Error detecting blog posts:', e);
      }
      
      features.hasTutorials = text.includes('how to') || text.includes('step by step') || text.includes('tutorial');
      features.hasComparisons = text.includes(' vs ') || text.includes('versus') || text.includes('comparison');
      
      try {
        features.hasQuestions = $('h1, h2, h3, h4').filter((_, el) => {
          try {
            return $(el).text().includes('?');
          } catch (e) {
            return false;
          }
        }).length > 0;
      } catch (e) {
        console.warn('[ContentExtractor] Error detecting questions:', e);
      }
      
      return features;
    } catch (error) {
      console.warn('[ContentExtractor] detectFeatures failed:', error);
      return {
        hasPaymentForms: false,
        hasProductListings: false,
        hasAPIDocumentation: false,
        hasPricingInfo: false,
        hasBlogPosts: false,
        hasTutorials: false,
        hasComparisons: false,
        hasQuestions: false,
      };
    }
  }
  
  private extractKeyTerms(): string[] {
    try {
      const terms: string[] = [];
      const words = (this.contentText || '').split(/\s+/);
      
      // Find capitalized phrases (likely important terms)
      try {
        for (let i = 0; i < Math.min(words.length - 1, 1000); i++) { // Limit iterations
          if (words[i] && words[i + 1] && words[i].match(/^[A-Z]/) && words[i + 1].match(/^[A-Z]/)) {
            terms.push(`${words[i]} ${words[i + 1]}`);
          }
        }
      } catch (e) {
        console.warn('[ContentExtractor] Error extracting capitalized phrases:', e);
      }
      
      // Find repeated significant words
      const wordCount = new Map<string, number>();
      const wordsToProcess = words.slice(0, 5000); // Limit words to process
      
      wordsToProcess.forEach(word => {
        try {
          if (!word) return;
          const cleaned = word.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (cleaned.length > 4 && !this.isCommonWord(cleaned)) {
            wordCount.set(cleaned, (wordCount.get(cleaned) || 0) + 1);
          }
        } catch (e) {
          console.warn('[ContentExtractor] Error processing word for key terms:', e);
        }
      });
      
      // Add frequently used terms
      try {
        Array.from(wordCount.entries())
          .filter(([_, count]) => count > 3)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .forEach(([word]) => terms.push(word));
      } catch (e) {
        console.warn('[ContentExtractor] Error sorting word frequencies:', e);
      }
      
      return Array.from(new Set(terms)).slice(0, 15);
    } catch (error) {
      console.warn('[ContentExtractor] extractKeyTerms failed:', error);
      return [];
    }
  }
  
  private extractProductNames(): string[] {
    try {
      const products: string[] = [];
      
      // Look for capitalized product-like names
      try {
        // Limit the content to analyze to prevent regex catastrophic backtracking
        const contentToAnalyze = (this.contentText || '').substring(0, 50000);
        const matches = contentToAnalyze.match(/\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2}(?:\s+(?:Pro|Plus|Premium|Enterprise|Basic|Standard|v?\d+(?:\.\d+)?))?/g) || [];
        
        matches.slice(0, 50).forEach(match => { // Limit matches to process
          try {
            if (match && match.length > 3 && !this.isCommonWord(match)) {
              products.push(match);
            }
          } catch (e) {
            console.warn('[ContentExtractor] Error processing product name:', e);
          }
        });
      } catch (e) {
        console.warn('[ContentExtractor] Error matching product patterns:', e);
      }
      
      return Array.from(new Set(products)).slice(0, 10);
    } catch (error) {
      console.warn('[ContentExtractor] extractProductNames failed:', error);
      return [];
    }
  }
  
  private extractTechnicalTerms(): string[] {
    try {
      const technical: string[] = [];
      
      // Limit content to analyze
      const contentToAnalyze = (this.contentText || '').substring(0, 50000);
      
      // Common technical patterns
      const patterns = [
        /\b[A-Z]{2,}(?:\s+[A-Z]{2,})*\b/g, // Acronyms like API, REST API
        /\b\w+(?:js|JS|py|\.io|\.ai|\.com)\b/g, // Tech names
        /\b(?:API|SDK|REST|JSON|XML|HTML|CSS|SQL)\b/gi,
      ];
      
      patterns.forEach(pattern => {
        try {
          const matches = contentToAnalyze.match(pattern) || [];
          technical.push(...matches.slice(0, 20)); // Limit matches per pattern
        } catch (e) {
          console.warn('[ContentExtractor] Error matching technical pattern:', e);
        }
      });
      
      return Array.from(new Set(technical)).slice(0, 10);
    } catch (error) {
      console.warn('[ContentExtractor] extractTechnicalTerms failed:', error);
      return [];
    }
  }
  
  /**
   * Detect the type of page based on URL patterns and DOM analysis
   */
  private detectPageType(): PageType {
    try {
      // URL-based detection
      let path = '';
      let hostname = '';
      if (this.pageUrl) {
        const url = new URL(this.pageUrl);
        path = url.pathname.toLowerCase();
        hostname = url.hostname.toLowerCase();
      }
      
      // Homepage detection - enhanced with more patterns and DOM checks
      if (path === '/' || path === '' || path === '/index' || path === '/index.html' || path === '/index.php' ||
          path === '/home' || path === '/home.html' || path === '/default.html' || path === '/default.aspx') {
        console.log(`[ContentExtractor] Detected homepage by URL pattern: ${this.pageUrl} (path: "${path}")`);
        return 'homepage';
      }
      
      // Additional homepage detection through DOM analysis
      if (path.length <= 1 || (path.length < 20 && !path.includes('/'))) {
        // Check for homepage indicators in content
        const hasHeroSection = this.$('.hero, .hero-section, .homepage-hero, .main-banner').length > 0;
        const hasMultipleSections = this.$('section').length > 3;
        const hasNavWithHome = this.$('nav a[href="/"], nav a[href="#home"]').length > 0;
        const titleIsCompanyName = this.$('title').text().toLowerCase().includes(hostname.split('.')[0]);
        
        if (hasHeroSection || (hasMultipleSections && hasNavWithHome) || titleIsCompanyName) {
          console.log(`[ContentExtractor] Detected homepage by DOM indicators: ${this.pageUrl}`);
          return 'homepage';
        }
      }
      
      // Check for article/blog patterns
      if (this.hasArticleSignals(path)) {
        return 'article';
      }
      
      // Product page detection
      if (path.includes('/product') || path.includes('/item') || path.includes('/p/') ||
          this.$('.product-page, .product-detail, .product-info').length > 0 ||
          this.$('[itemtype*="Product"]').length > 0) {
        return 'product';
      }
      
      // Category/listing page detection
      if (path.includes('/category') || path.includes('/categories') || path.includes('/shop') ||
          path.includes('/collection') || path.includes('/catalog') ||
          this.$('.category-grid, .product-grid, .listing-grid').length > 0) {
        return 'category';
      }
      
      // About page detection
      if (path.includes('/about') || path.includes('/team') || path.includes('/company') ||
          path.includes('/who-we-are') || path.includes('/our-story')) {
        return 'about';
      }
      
      // Contact page detection
      if (path.includes('/contact') || path.includes('/get-in-touch') || path.includes('/reach-us') ||
          this.$('form[action*="contact"], form[action*="mail"]').length > 0) {
        return 'contact';
      }
      
      // Documentation detection
      if (path.includes('/docs') || path.includes('/documentation') || path.includes('/api') ||
          path.includes('/guide') || path.includes('/manual') || path.includes('/wiki') ||
          this.$('.docs-content, .documentation, .api-reference').length > 0) {
        return 'documentation';
      }
      
      // Search results page detection
      if (path.includes('/search') || path.includes('/results') || 
          this.pageUrl?.includes('q=') || this.pageUrl?.includes('query=') ||
          this.$('.search-results, .results-list').length > 0) {
        return 'search';
      }
      
      // If none match, return general
      console.log(`[ContentExtractor] No specific page type detected, defaulting to general: ${this.pageUrl}`);
      return 'general';
      
    } catch (error) {
      console.warn('[ContentExtractor] detectPageType failed:', error);
      return 'general';
    }
  }
  
  /**
   * Check if URL or content indicates an article/blog post
   */
  private hasArticleSignals(path: string): boolean {
    // URL patterns for articles
    if (path.includes('/blog/') || path.includes('/post/') || path.includes('/article/') ||
        path.includes('/news/') || path.includes('/story/')) {
      return true;
    }
    
    // Date patterns in URL (e.g., /2023/07/article-title)
    if (path.match(/\/\d{4}\/\d{2}\//)) {
      return true;
    }
    
    // Check DOM for article indicators
    if (this.$('article, .article, .post, .blog-post').length > 0 ||
        this.$('[itemtype*="Article"], [itemtype*="BlogPosting"]').length > 0 ||
        this.$('.publish-date, .post-date, .article-date, .byline, .author-info').length > 0) {
      return true;
    }
    
    return false;
  }

  private isCommonWord(word: string): boolean {
    const common = [
      'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
      'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
      'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
      'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their',
      'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go',
      'me', 'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know',
      'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them',
      'see', 'other', 'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over'
    ];
    
    return common.includes(word.toLowerCase());
  }
}

// Add default export for better Next.js compatibility
export default ContentExtractor;