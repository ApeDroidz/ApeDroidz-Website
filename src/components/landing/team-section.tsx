"use client"

import { User } from "lucide-react"
import { TEAM, TeamMember } from "@/lib/landing-data"
import { LABEL_CLASS, Reveal } from "./ui"

function TeamCard({ member, index }: { member: TeamMember; index: number }) {
  const card = (
    <div className="w-full rounded-2xl border border-white/10 bg-white/[0.02] p-5 hover:border-white/25 hover:bg-white/[0.04] transition-colors duration-300">
      <div className="aspect-square rounded-xl bg-[#111] border border-white/5 flex items-center justify-center overflow-hidden mb-5">
        {member.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={member.avatar} alt={member.name} loading="lazy" draggable={false} className="w-full h-full object-cover" />
        ) : (
          <User className="w-10 h-10 text-white/10" />
        )}
      </div>
      <div className="font-medium tracking-tight text-lg truncate">{member.name}</div>
      <div className={`${LABEL_CLASS} text-white/30 mt-1.5`}>{member.role}</div>
    </div>
  )
  return (
    <Reveal delay={0.06 * index}>
      {member.url ? (
        <a href={member.url} target="_blank" rel="noopener noreferrer">{card}</a>
      ) : card}
    </Reveal>
  )
}

export function TeamSection() {
  if (TEAM.length === 0) return null
  return (
    <section className="relative py-20 md:py-28">
      <div className="w-full px-[5vw]">
        <Reveal>
          <div className={`${LABEL_CLASS} text-white/35 mb-4`}>The Crew</div>
          <h2 className="font-semibold tracking-tight text-[clamp(2.2rem,4.6vw,4rem)] leading-none">Team</h2>
          <p className="mt-6 max-w-xl font-sans text-base md:text-lg leading-relaxed">
            <span className="text-white">The operators behind the Droidz Network.</span>
          </p>
        </Reveal>

        <div className="mt-14 grid grid-cols-2 md:grid-cols-3 gap-4 max-w-3xl">
          {TEAM.map((m, i) => <TeamCard key={m.name + m.role} member={m} index={i} />)}
        </div>
      </div>
    </section>
  )
}
