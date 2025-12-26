# Source Application Library

A decentralized File Discovery and Verification library built on Ergo blockchain. This library provides both Svelte components and TypeScript functions for building file source applications with reputation-based trust mechanisms.

## Installation

```bash
npm install source-application
```

## Features

- **Decentralized File Discovery**: Find and share download sources for files by hash
- **Reputation System**: Trust-based verification using Ergo blockchain reputation proofs
- **Opinion Mechanisms**: Confirm, invalidate, or mark sources as unavailable
- **Profile Management**: Create and manage user reputation profiles
- **Island Components**: Three ready-to-use Svelte components that work standalone
- **TypeScript SDK**: Full API for custom integrations

---

## Svelte Components

### ProfileCard

Profile creation and basic information display.

**Props:**
- `profile: ReputationProof | null` - Current user's profile
- `explorerUri: string` - Ergo Explorer API endpoint
- `onProfileCreated?: (txId: string) => void` - Callback when profile is created

**Usage:**
```svelte
<script>
  import { ProfileCard } from 'source-application';
  
  let profile = null;
  let explorerUri = "https://api.ergoplatform.com";
</script>

<ProfileCard 
  {profile}
  {explorerUri}
  onProfileCreated={(tx) => console.log('Profile created:', tx)}
/>
```

---

### FileSourceCreation

Form for adding new file sources to the network.

**Props:**
- `profile: ReputationProof | null` - Current user's profile (required to enable adding)
- `explorerUri: string` - Ergo Explorer API endpoint
- `onSourceAdded?: (txId: string) => void` - Callback when source is added

**Usage:**
```svelte
<script>
  import { FileSourceCreation } from 'source-application';
  
  let profile = { ... }; // Load from fetchProfile
  let explorerUri = "https://api.ergoplatform.com";
</script>

<FileSourceCreation 
  {profile}
  {explorerUri}
  onSourceAdded={(tx) => console.log('Source added:', tx)}
/>
```

---

### FileCard

Complete file source display for a specific file hash, including tabs for sources, profile views, and timeline.

**Props:**
- `fileHash: string` - The Blake2b256 hash of the file to display (required)
- `profile: ReputationProof | null` - The current user's profile (optional, for enabling actions)
- `sources: FileSource[]` - List of sources for this hash
- `invalidFileSources: CachedData<InvalidFileSource[]>` - Map of invalidations
- `unavailableSources: CachedData<UnavailableSource[]>` - Map of unavailabilities
- `isLoading: boolean` - Loading state
- `explorerUri: string` - Ergo Explorer API endpoint
- `webExplorerUriTkn: string` - Web explorer token link template
- `class?: string` - CSS class for the container (optional)

**Usage:**
```svelte
<script>
  import { FileCard } from 'source-application';
  
  let fileHash = "abc123...";
  let profile = null;
  let explorerUri = "https://api.ergoplatform.com";
  let webExplorerUriTkn = "https://sigmaspace.io/en/token/";
</script>

<FileCard 
  {fileHash}
  {profile}
  {explorerUri}
  {webExplorerUriTkn}
  sources={[]}
  invalidFileSources={{}}
  unavailableSources={{}}
  isLoading={false}
/>
```

---

## TypeScript SDK

### Profile Functions

#### createProfileBox
Create a new reputation profile for the user.

```typescript
import { createProfileBox } from 'source-application';

const txId = await createProfileBox(explorerUri);
// Returns: string (transaction ID)
```

---

### Source Fetch Functions

#### fetchFileSourcesByHash
Fetch all FILE_SOURCE boxes for a specific file hash.

```typescript
import { fetchFileSourcesByHash } from 'source-application';

const sources = await fetchFileSourcesByHash("abc123...", explorerUri);
// Returns: FileSource[]
```

#### fetchFileSourcesByProfile
Fetch all file sources created by a specific profile.

```typescript
import { fetchFileSourcesByProfile } from 'source-application';

const sources = await fetchFileSourcesByProfile(profileTokenId, limit, explorerUri);
// Returns: FileSource[]
```

#### Other Fetch Functions
- `fetchInvalidFileSources(sourceBoxId, explorerUri)` - Get invalidations for a source
- `fetchUnavailableSources(sourceUrl, explorerUri)` - Get unavailability reports for a URL
- `fetchProfileOpinions(profileTokenId, explorerUri)` - Get trust/distrust opinions for a profile
- `fetchInvalidFileSourcesByProfile(profileTokenId, limit, explorerUri)` - Get invalidations by profile
- `fetchUnavailableSourcesByProfile(profileTokenId, limit, explorerUri)` - Get unavailabilities by profile
- `fetchProfileOpinionsByAuthor(authorTokenId, explorerUri)` - Get opinions given by a profile
- `searchByHash(fileHash, explorerUri)` - Load file sources, invalidations, and unavailabilities
- `loadProfileData(profileTokenId, explorerUri)` - Load all data related to a profile

---

### Source Store Functions (Actions)

#### addFileSource
Add a new file source to the network.

```typescript
import { addFileSource } from 'source-application';

const txId = await addFileSource(
  "abc123...", // file hash
  "https://example.com/file.zip", // source URL
  profile, // ReputationProof
  explorerUri
);
```

#### confirmSource
Confirm an existing file source (create duplicate FILE_SOURCE).

```typescript
import { confirmSource } from 'source-application';

const txId = await confirmSource(
  "abc123...", // file hash
  "https://example.com/file.zip", // source URL
  profile, // ReputationProof
  currentSources, // FileSource[]
  explorerUri
);
```

#### markInvalidSource
Mark a file source as fake or incorrect.

```typescript
import { markInvalidSource } from 'source-application';

const txId = await markInvalidSource(sourceBoxId, profile, explorerUri);
```

#### markUnavailableSource
Mark a source URL as no longer available.

```typescript
import { markUnavailableSource } from 'source-application';

const txId = await markUnavailableSource(sourceUrl, profile, explorerUri);
```

#### updateFileSource
Update an existing file source with a new URL.

```typescript
import { updateFileSource } from 'source-application';

const txId = await updateFileSource(
  oldBoxId,
  fileHash,
  newSourceUrl,
  profile,
  explorerUri
);
```

#### trustProfile
Express trust or distrust for a profile.

```typescript
import { trustProfile } from 'source-application';

const txId = await trustProfile(profileTokenId, isTrusted, profile, explorerUri);
```

---

### Helper Functions

#### groupByDownloadSource
Group file sources by their download URL.

```typescript
import { groupByDownloadSource } from 'source-application';

const groups = groupByDownloadSource(
  sources,
  invalidationsMap,
  unavailabilitiesMap
);
// Returns: DownloadSourceGroup[]
```

#### groupByProfile
Group file sources by the profile that submitted them.

```typescript
import { groupByProfile } from 'source-application';

const groups = groupByProfile(sources);
// Returns: ProfileSourceGroup[]
```

#### calculateProfileTrust
Calculate trust score for a profile based on opinions.

```typescript
import { calculateProfileTrust } from 'source-application';

const trustScore = calculateProfileTrust(profileTokenId, opinions);
// Returns: number
```

#### aggregateSourceScore
Aggregate all opinion data for a file source.

```typescript
import { aggregateSourceScore } from 'source-application';

const scoreData = aggregateSourceScore(
  source,
  allSources,
  invalidations,
  unavailabilities,
  profileOpinions
);
// Returns: FileSourceWithScore
```

---

## TypeScript Types

### Core Interfaces

```typescript
import type {
  FileSource,
  InvalidFileSource,
  UnavailableSource,
  ProfileOpinion,
  ReputationProof,
  RPBox,
  CachedData,
  SearchResult,
  ProfileData
} from 'source-application';
```

---

## Environment Constants

```typescript
import {
  PROFILE_TYPE_NFT_ID,
  FILE_SOURCE_TYPE_NFT_ID,
  INVALID_FILE_SOURCE_TYPE_NFT_ID,
  UNAVAILABLE_SOURCE_TYPE_NFT_ID,
  PROFILE_OPINION_TYPE_NFT_ID,
  PROFILE_TOTAL_SUPPLY
} from 'source-application';
```

---

## Notes

- All blockchain interactions require an Ergo wallet connection.
- The library does not include internal stores; state management should be handled by the consuming application.
- Components are self-contained and receive data via props.
- All URLs are sanitized for security.

## License

MIT
