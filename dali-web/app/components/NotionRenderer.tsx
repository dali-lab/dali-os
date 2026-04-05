import React from "react";

interface RichText {
  type: string;
  text?: {
    content: string;
    link?: { url: string };
  };
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
    code?: boolean;
    color?: string;
  };
  plain_text?: string;
}

interface NotionBlock {
  id: string;
  type: string;
  paragraph?: { rich_text: RichText[] };
  heading_1?: { rich_text: RichText[] };
  heading_2?: { rich_text: RichText[] };
  heading_3?: { rich_text: RichText[] };
  bulleted_list_item?: { rich_text: RichText[] };
  numbered_list_item?: { rich_text: RichText[] };
  toggle?: { rich_text: RichText[] };
  quote?: { rich_text: RichText[] };
  callout?: {
    rich_text: RichText[];
    icon?: { emoji?: string };
  };
  code?: {
    rich_text: RichText[];
    language?: string;
  };
  image?: {
    file?: { url: string };
    external?: { url: string };
    caption?: RichText[];
  };
  video?: {
    file?: { url: string };
    external?: { url: string };
  };
  divider?: {};
  children?: NotionBlock[];
  raw?: any;
}

const RichTextRenderer: React.FC<{ richText: RichText[] }> = ({ richText }) => {
  if (!richText || richText.length === 0) return null;

  return (
    <>
      {richText.map((text, index) => {
        const content = text.text?.content || text.plain_text || "";
        const annotations = text.annotations || {};

        let element = <span key={index}>{content}</span>;

        if (annotations.bold) {
          element = <strong key={index}>{content}</strong>;
        }
        if (annotations.italic) {
          element = <em key={index}>{element}</em>;
        }
        if (annotations.code) {
          element = (
            <code
              key={index}
              className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-sm"
            >
              {content}
            </code>
          );
        }
        if (annotations.strikethrough) {
          element = <del key={index}>{element}</del>;
        }
        if (annotations.underline) {
          element = <u key={index}>{element}</u>;
        }
        if (text.text?.link) {
          element = (
            <a
              key={index}
              href={text.text.link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              {element}
            </a>
          );
        }

        return element;
      })}
    </>
  );
};

const NotionBlockRenderer: React.FC<{
  block: NotionBlock;
  isNested?: boolean;
}> = ({ block, isNested = false }) => {
  const baseClass = isNested ? "" : "mb-4";

  switch (block.type) {
    case "paragraph":
      if (!block.paragraph?.rich_text?.length) return null;
      return (
        <p className={`${baseClass} leading-relaxed`}>
          <RichTextRenderer richText={block.paragraph.rich_text} />
        </p>
      );

    case "heading_1":
      return (
        <h1 className={`${baseClass} text-3xl font-bold mt-6`}>
          <RichTextRenderer richText={block.heading_1?.rich_text || []} />
        </h1>
      );

    case "heading_2":
      return (
        <h2 className={`${baseClass} text-2xl font-semibold mt-5`}>
          <RichTextRenderer richText={block.heading_2?.rich_text || []} />
        </h2>
      );

    case "heading_3":
      return (
        <h3 className={`${baseClass} text-xl font-semibold mt-4`}>
          <RichTextRenderer richText={block.heading_3?.rich_text || []} />
        </h3>
      );

    case "bulleted_list_item":
      return (
        <li className="ml-6 list-disc">
          <RichTextRenderer
            richText={block.bulleted_list_item?.rich_text || []}
          />
        </li>
      );

    case "numbered_list_item":
      return (
        <li className="ml-6 list-decimal">
          <RichTextRenderer
            richText={block.numbered_list_item?.rich_text || []}
          />
        </li>
      );

    case "toggle":
      return (
        <details className={`${baseClass} cursor-pointer`}>
          <summary className="font-medium">
            <RichTextRenderer richText={block.toggle?.rich_text || []} />
          </summary>
          {block.children && (
            <div className="pl-4 mt-2">
              {block.children.map((child) => (
                <NotionBlockRenderer key={child.id} block={child} isNested />
              ))}
            </div>
          )}
        </details>
      );

    case "quote":
      return (
        <blockquote
          className={`${baseClass} border-l-4 border-gray-300 dark:border-gray-600 pl-4 italic`}
        >
          <RichTextRenderer richText={block.quote?.rich_text || []} />
        </blockquote>
      );

    case "callout":
      return (
        <div className={`${baseClass} p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg flex gap-2`}>
          {block.callout?.icon?.emoji && (
            <span className="text-xl">{block.callout.icon.emoji}</span>
          )}
          <div>
            <RichTextRenderer richText={block.callout?.rich_text || []} />
          </div>
        </div>
      );

    case "code":
      return (
        <pre
          className={`${baseClass} p-4 bg-gray-900 text-gray-100 rounded-lg overflow-x-auto`}
        >
          <code className="text-sm">
            <RichTextRenderer richText={block.code?.rich_text || []} />
          </code>
        </pre>
      );

    case "image":
      const imageUrl = block.image?.file?.url || block.image?.external?.url;
      if (!imageUrl) return null;
      return (
        <figure className={`${baseClass}`}>
          <img src={imageUrl} alt="Content" className="w-full rounded-lg dark:border dark:border-gray-600" />
          {block.image?.caption && block.image.caption.length > 0 && (
            <figcaption className="text-sm text-gray-600 dark:text-gray-400 mt-2 text-center">
              <RichTextRenderer richText={block.image.caption} />
            </figcaption>
          )}
        </figure>
      );

    case "video":
      const videoUrl = block.video?.file?.url || block.video?.external?.url;
      if (!videoUrl) return null;
      return (
        <div className={`${baseClass}`}>
          <video src={videoUrl} controls className="w-full rounded-lg" />
        </div>
      );

    case "divider":
      return <hr className={`${baseClass} border-gray-300 dark:border-gray-600`} />;

    case "column_list":
      return (
        <div className={`${baseClass} grid grid-cols-1 md:grid-cols-2 gap-4`}>
          {block.children?.map((child) => (
            <div key={child.id}>
              <NotionBlockRenderer block={child} isNested />
            </div>
          ))}
        </div>
      );

    case "column":
      return (
        <div>
          {block.children?.map((child) => (
            <NotionBlockRenderer key={child.id} block={child} isNested />
          ))}
        </div>
      );

    default:
      return null;
  }
};

export const NotionRenderer: React.FC<{ blocks: NotionBlock[] }> = ({
  blocks,
}) => {
  if (!blocks || blocks.length === 0) {
    return <p className="text-gray-500 dark:text-gray-400">No content available</p>;
  }

  // Group consecutive list items
  const groupedBlocks: (NotionBlock | NotionBlock[])[] = [];
  let currentList: NotionBlock[] = [];
  let listType: "bulleted" | "numbered" | null = null;

  blocks.forEach((block, index) => {
    if (block.type === "bulleted_list_item") {
      if (listType === "bulleted") {
        currentList.push(block);
      } else {
        if (currentList.length > 0) {
          groupedBlocks.push(currentList);
        }
        currentList = [block];
        listType = "bulleted";
      }
    } else if (block.type === "numbered_list_item") {
      if (listType === "numbered") {
        currentList.push(block);
      } else {
        if (currentList.length > 0) {
          groupedBlocks.push(currentList);
        }
        currentList = [block];
        listType = "numbered";
      }
    } else {
      if (currentList.length > 0) {
        groupedBlocks.push(currentList);
        currentList = [];
        listType = null;
      }
      groupedBlocks.push(block);
    }

    // Handle last item
    if (index === blocks.length - 1 && currentList.length > 0) {
      groupedBlocks.push(currentList);
    }
  });

  return (
    <div className="prose prose-gray max-w-none">
      {groupedBlocks.map((item, index) => {
        if (Array.isArray(item)) {
          // It's a list
          const ListTag = item[0].type === "bulleted_list_item" ? "ul" : "ol";
          return (
            <ListTag key={index} className="mb-4">
              {item.map((block) => (
                <NotionBlockRenderer key={block.id} block={block} isNested />
              ))}
            </ListTag>
          );
        } else {
          // It's a single block
          return <NotionBlockRenderer key={item.id} block={item} />;
        }
      })}
    </div>
  );
};
