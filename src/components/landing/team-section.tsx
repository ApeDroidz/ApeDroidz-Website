"use client"

import { User } from "lucide-react"
import { TEAM, TeamMember } from "@/lib/landing-data"
import { LABEL_CLASS, Reveal, SectionHeader } from "./ui"

function TeamCard({ member }: { member: TeamMember }) {
  const card = (
    <div className="w-full rounded-2xl border border-white/10 bg-[#0a0a0a] p-5 hover:border-white/30 transition-colors duration-300">
      <div className="aspect-square rounded-xl bg-[#1a1a1a] border border-white/5 flex items-center justify-center overflow-hidden mb-4">
        {member.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={member.avatar} alt={member.name} loading="lazy" draggable={false} className="w-full h-full object-cover" />
        ) : (
          <User className="w-10 h-10 text-white/15" />
        )}
      </div>
      <div className="font-black uppercase tracking-tight text-lg truncate">{member.name}</div>
      <div className={`${LABEL_CLASS} text-white/40 mt-1`}>{member.role}</div>
    </div>
  )
  return member.url ? (
    <a href={member.url} target="_blank" rel="noopener noreferrer">{card}</a>
  ) : card
}

export function TeamSection() {
  if (TEAM.length === 0) return null
  return (
    <section className="relative py-24 md:py-32 border-t border-white/10">
      <div className="max-w-6xl mx-auto px-6">
        <SectionHeader
          label="The Crew"
          title="Team"
          description="The operators behind the Droidz Network."
        />
        <Reveal className="mt-14 grid grid-cols-2 md:grid-cols-3 gap-4 max-w-3xl mx-auto">
          {TEAM.map((m) => <TeamCard key={m.name + m.role} member={m} />)}
        </Reveal>
      </div>
    </section>
  )
}
